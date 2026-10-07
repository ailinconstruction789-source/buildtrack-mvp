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

// Mock supabase client
const mockSales = [
  // Transferred in 2024
  {
    saleId: 'sale-2024-1',
    plotId: 'plot-1',
    plotName: 'แปลง 1',
    projectName: 'โครงการ A',
    customerName: 'ลูกค้า 2024',
    ownerName: 'Sales 1',
    salePrice: 3000000,
    tdPrice: 3200000,
    stage: 'transferred',
    bookedAt: '2024-02-01T00:00:00Z',
    transferredAt: '2024-05-15T00:00:00Z',
  },
  // Transferred in 2026
  {
    saleId: 'sale-2026-1',
    plotId: 'plot-2',
    plotName: 'แปลง 2',
    projectName: 'โครงการ A',
    customerName: 'ลูกค้า 2026 โอน',
    ownerName: 'Sales 2',
    salePrice: 4000000,
    tdPrice: 4500000,
    stage: 'transferred',
    bookedAt: '2026-03-01T00:00:00Z',
    transferredAt: '2026-06-20T00:00:00Z',
  },
  // Waiting in 2026
  {
    saleId: 'sale-2026-2',
    plotId: 'plot-3',
    plotName: 'แปลง 3',
    projectName: 'โครงการ A',
    customerName: 'ลูกค้า 2026 รอโอน',
    ownerName: 'Sales 2',
    salePrice: 2500000,
    tdPrice: 2700000,
    stage: 'booked',
    bookedAt: '2026-08-10T00:00:00Z',
    expectedTransferDate: '2026-09-30',
  },
  // Closed project plot transferred in 2024
  {
    saleId: 'sale-old-1',
    plotId: 'plot-5',
    plotName: 'แปลงเก่า 1',
    projectName: 'โครงการเก่า B',
    customerName: 'ลูกค้าเก่า',
    ownerName: 'Sales 1',
    salePrice: 2000000,
    tdPrice: 2000000,
    stage: 'transferred',
    bookedAt: '2023-12-01T00:00:00Z',
    transferredAt: '2024-01-01T00:00:00Z',
  }
];

const mockPlots = [
  { id: 'plot-1', plot_name: 'แปลง 1', project_name: 'โครงการ A', selling_price: 3000000, land_appraisal_price: 3200000 },
  { id: 'plot-2', plot_name: 'แปลง 2', project_name: 'โครงการ A', selling_price: 4000000, land_appraisal_price: 4500000 },
  { id: 'plot-3', plot_name: 'แปลง 3', project_name: 'โครงการ A', selling_price: 2500000, land_appraisal_price: 2700000 },
  { id: 'plot-4', plot_name: 'แปลง 4', project_name: 'โครงการ A', selling_price: 3500000, land_appraisal_price: 3500000 }, // Available
  { id: 'plot-5', plot_name: 'แปลงเก่า 1', project_name: 'โครงการเก่า B', selling_price: 2000000, land_appraisal_price: 2000000 }, // Closed
];

const mockProjects = [
  { name: 'โครงการ A', is_closed: false },
  { name: 'โครงการเก่า B', is_closed: true }
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

describe('SalesDashboardExcelStyle - Year Scoped Metrics', () => {
  it('correctly calculates year-scoped sales and appraisal without mixing prior years', async () => {
    render(<SalesDashboardExcelStyle />);

    // Wait for data load
    await screen.findByText(/Monthly Sale Report 2026/);

    // Red Box 1: KPI Badge should show 2026 sales (4,000,000 transferred + 2,500,000 waiting = 6,500,000, 2 units)
    // and NOT 3,000,000 from 2024
    expect(screen.getByText(/ยอดขายรวม \(โอน \+ จอง\) ปี 2026/)).toBeInTheDocument();
    expect(screen.getByText('2 หลัง')).toBeInTheDocument();
    expect(screen.getByText('฿6,500,000')).toBeInTheDocument();

    // Red Box 1: ท.ด. should be 4,500,000 + 2,700,000 = 7,200,000
    expect(screen.getByText(/ยอด ท.ด. ปี 2026/)).toBeInTheDocument();
    expect(screen.getByText('฿7,200,000')).toBeInTheDocument();

    // Red Box 2: Card 4 should show 2026 transferred (1 หลัง, ฿4,000,000) and waiting (1 หลัง, ฿2,500,000)
    expect(screen.getByText(/บ้านทั้งหมด \(ปี 2026\)/)).toBeInTheDocument();
    expect(screen.getByText(/ยอดโอนสะสม \(ปี 2026\)/)).toBeInTheDocument();
    expect(screen.getByText(/ยอดรอโอน \(ปี 2026\)/)).toBeInTheDocument();

    // Available plot 4 (1 หลัง, ฿3,500,000)
    expect(screen.getByText(/ยอดคงเหลือ \(ว่าง\)/)).toBeInTheDocument();
    expect(screen.getByText('฿3,500,000')).toBeInTheDocument();
  });

  it('updates both red boxes dynamically when switching to a different year in date picker', async () => {
    const { container } = render(<SalesDashboardExcelStyle />);

    await screen.findByText(/Monthly Sale Report 2026/);

    // Find date input and change to 2024-12-31
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).not.toBeNull();

    fireEvent.change(dateInput, { target: { value: '2024-12-31' } });

    // Header title should update to 2024
    await screen.findByText(/Monthly Sale Report 2024/);

    // Red Box 1: KPI Badge should now show 2024 sales (3,000,000 transferred = 3,000,000, 1 unit)
    expect(screen.getByText(/ยอดขายรวม \(โอน \+ จอง\) ปี 2024/)).toBeInTheDocument();
    expect(screen.getAllByText(/1\s*หลัง/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('฿3,000,000').length).toBeGreaterThanOrEqual(1);

    // Red Box 1: ท.ด. should be 3,200,000
    expect(screen.getByText(/ยอด ท.ด. ปี 2024/)).toBeInTheDocument();
    expect(screen.getByText('฿3,200,000')).toBeInTheDocument();

    // Red Box 2: Card 4 should show 2024 transferred (1 หลัง, ฿3,000,000)
    expect(screen.getByText(/บ้านทั้งหมด \(ปี 2024\)/)).toBeInTheDocument();
    expect(screen.getByText(/ยอดโอนสะสม \(ปี 2024\)/)).toBeInTheDocument();
  });

  it('filters out closed projects and displays year-scoped total per project and Grand Total in table', async () => {
    render(<SalesDashboardExcelStyle />);

    await screen.findByText(/Monthly Sale Report 2026/);

    // Active project 'โครงการ A' should be present
    expect(screen.getAllByText('โครงการ A').length).toBeGreaterThanOrEqual(1);

    // Closed project 'โครงการเก่า B' should be excluded from active projects table
    expect(screen.queryByText('โครงการเก่า B')).not.toBeInTheDocument();

    // In 'โครงการ A' row:
    // โอน = 1, รอโอน = 1, ว่าง = 1, ทั้งหมด = 3 (not 4)
    // Grand Total row:
    // Grand Total = 3
    const grandTotalRow = screen.getByText('Grand Total').closest('tr');
    expect(grandTotalRow).not.toBeNull();
    const cells = grandTotalRow?.querySelectorAll('td');
    expect(cells?.[1]?.textContent?.trim()).toBe('1'); // โอน
    expect(cells?.[2]?.textContent?.trim()).toBe('1'); // รอโอน
    expect(cells?.[3]?.textContent?.trim()).toBe('1'); // ว่าง
    expect(cells?.[4]?.textContent?.trim()).toBe('3'); // ทั้งหมด (1 + 1 + 1 = 3)

    // Test row expansion: clicking on project row reveals plots
    const projRow = screen.getByText('โครงการ A', { selector: 'td' });
    fireEvent.click(projRow);

    // Should reveal plot names in expanded section
    expect(screen.getByText('รายชื่อแปลง:')).toBeInTheDocument();
    expect(screen.getByText('แปลง 2')).toBeInTheDocument();
    expect(screen.getByText('แปลง 3')).toBeInTheDocument();
    expect(screen.getByText('แปลง 4')).toBeInTheDocument();
    // Prior transferred plot from 2024 (แปลง 1) shouldn't be under transferredPlots
    expect(screen.queryByText('แปลงเก่า 1')).not.toBeInTheDocument();
  });

  it('modal breakdown only shows active projects and units for the selected year', async () => {
    render(<SalesDashboardExcelStyle />);

    await screen.findByText(/Monthly Sale Report 2026/);

    // Click on Card 4 to open breakdown modal
    const card4 = screen.getByText(/บ้านทั้งหมด \(ปี 2026\)/).closest('div[class*="cursor-pointer"]');
    expect(card4).not.toBeNull();
    fireEvent.click(card4!);

    // Modal title should appear
    expect(screen.getByText('รายละเอียดรวมบ้านทั้งหมด (ปี 2026)')).toBeInTheDocument();

    // Modal should have โครงการ A and NOT โครงการเก่า B
    expect(screen.getByText('โครงการ A', { selector: 'h4' })).toBeInTheDocument();
    expect(screen.queryByText('โครงการเก่า B', { selector: 'h4' })).not.toBeInTheDocument();
  });
});
