import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SalesDashboardExcelStyle from '../SalesDashboardExcelStyle';
import WaitingForTransferDetails from '../WaitingForTransferDetails';

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({
  fetchSalesWithoutLimit: vi.fn(async (table: string) => {
    if (table === 'plots') {
      return [
        {
          id: 'plot-ailin4-68',
          plot_name: '68',
          selling_price: 4184000,
          land_appraisal_price: 4184000,
          project_name: 'ไอลิน 4',
          sale_status: 'ready_for_sale'
        },
        {
          id: 'plot-ailin6-6',
          plot_name: '6',
          selling_price: 4657000,
          land_appraisal_price: 0,
          project_name: 'ไอลิน6',
          sale_status: 'ready_for_sale'
        },
        {
          id: 'plot-ailin6-15',
          plot_name: '15',
          selling_price: 2949000,
          land_appraisal_price: 0,
          project_name: 'ไอลิน6',
          sale_status: 'ready_for_sale'
        }
      ];
    }
    if (table === 'leads') {
      return [
        {
          id: 'lead-thamnoon',
          customer_name: 'นายธรรมนูญ พุ่มจำปา',
          project_name: 'ไอลิน6',
          status: 'Reserved',
          booking_date: '2026-10-02T05:00:00+00:00',
          interested_plot_id: 'plot-ailin6-6',
          interested_plot_name: '6',
          notes: 'เช่าซื้อ, ซื้อพร้อมผู้เช่า · ที่ดิน 53.9 ตร.ว. · ราคา: 4,657,000 บ. · คาดโอน: ต.ค. 2569'
        },
        {
          id: 'lead-sureenipa',
          customer_name: 'นางสาวสุรีย์นิภา ศรีรัตน์',
          project_name: 'ไอลิน6',
          status: 'Reserved',
          booking_date: '2026-10-04T05:00:00+00:00',
          interested_plot_id: 'plot-ailin6-15',
          interested_plot_name: '15',
          notes: 'เตรียมเอกสาร · ที่ดิน 55.3 ตร.ว. · ราคา: 2,899,000 บ. · คาดโอน: ต.ค. 2569'
        },
        {
          id: 'lead-kredkaew',
          customer_name: 'นางสาวเกร็ดแก้ว อ่อนสกุล',
          project_name: 'ไอลิน 4',
          status: 'Cancelled',
          crm_status: 'Cancelled — ยกเลิกจอง',
          auto_status: 'ยกเลิกจอง',
          booking_date: '2026-09-03T05:00:00+00:00',
          interested_plot_id: 'plot-ailin4-68',
          interested_plot_name: '68',
          lost_reason: 'ยกเลิกจอง',
          lost_reason_detail: 'วันที่ยกเลิก: 2026-10-07',
          notes: 'ราคา: 4,184,000 บ. · วันที่ยกเลิก: 2026-10-07'
        }
      ];
    }
    if (table === 'sales') {
      return [
        {
          id: 'legacy-cancelled-sale',
          lead_id: null,
          plot_id: 'plot-ailin6-6',
          sale_price: 4657000,
          contract_status: 'Cancelled',
          crm_stage: 'cancelled',
          booking_route: 'legacy_import',
          booked_at: null,
          transferred_at: null,
          cancelled_at: null,
          created_at: '2026-09-29T10:12:41.314157+00:00'
        }
      ];
    }
    return [];
  })
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        order: vi.fn(() => Promise.resolve({
          data: table === 'projects' ? [{ id: 'p1', name: 'ไอลิน6', is_closed: false }, { id: 'p2', name: 'ไอลิน 4', is_closed: false }] : [],
          error: null
        })),
        then: vi.fn((resolve: (val: any) => void) => {
          resolve({
            data: table === 'projects' ? [{ id: 'p1', name: 'ไอลิน6', is_closed: false }, { id: 'p2', name: 'ไอลิน 4', is_closed: false }] : [],
            error: null
          });
        })
      }))
    })),
    rpc: vi.fn(async () => {
      // Simulate RPC error so it falls back to direct tables
      return { data: null, error: { message: 'CRM_PROJECT_SALES_SETUP_REQUIRED' } };
    })
  }
}));

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
  LabelList: () => null
}));

describe('SalesDashboard and WaitingForTransferDetails Price & Transfer Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders agreed prices, appraisal prices, and customer names in WaitingForTransferDetails cards', async () => {
    const dummyPlot = {
      id: 'plot-ailin6-6',
      plot_name: '6',
      project_name: 'ไอลิน6',
      selling_price: 4657000,
      price: 4657000,
      appraisal: 4657000,
      activeSale: {
        saleId: 'sale-1',
        customerName: 'นายธรรมนูญ พุ่มจำปา',
        salePrice: 4657000,
        tdPrice: 4657000,
        expectedTransferDate: '2026-10-31'
      }
    };

    const validRecords = [
      {
        id: 'sale-1',
        saleId: 'sale-1',
        plot_id: 'plot-ailin6-6',
        plot_name: '6',
        project_name: 'ไอลิน6',
        customer_name: 'นายธรรมนูญ พุ่มจำปา',
        salePrice: 4657000,
        tdPrice: 4657000,
        expectedTransfer: '2026-10-31',
        stage: 'booked',
        status: 'Reserved'
      }
    ];

    render(
      <WaitingForTransferDetails 
        plots={[dummyPlot]}
        validRecords={validRecords}
      />
    );

    // Verify customer name
    expect(await screen.findByText(/นายธรรมนูญ พุ่มจำปา/)).toBeInTheDocument();

    // Verify agreed price displayed in the card
    expect(screen.getAllByText(/4,657,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ราคาขาย (ตกลง)')).toBeInTheDocument();
    expect(screen.getByText('ยอดขาย ทด. ประเมิน')).toBeInTheDocument();
  });

  it('connects October 2026 booked leads with agreed prices in SalesDashboardExcelStyle', async () => {
    render(<SalesDashboardExcelStyle isActive={true} />);

    // Wait for the dashboard to finish loading
    await waitFor(() => {
      expect(screen.getByText(/Monthly Sale Report/)).toBeInTheDocument();
    });

    // Check that customer names from active leads appear in customer list or waiting plots
    await waitFor(() => {
      expect(screen.getAllByText(/นายธรรมนูญ พุ่มจำปา/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/นางสาวสุรีย์นิภา ศรีรัตน์/).length).toBeGreaterThanOrEqual(1);
    });

    // Verify agreed prices are rendered rather than 0
    expect(screen.getAllByText(/4,657,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2,899,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('switches to all projects when selecting ทุกโครงการ and does not remain stuck on a single project', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<SalesDashboardExcelStyle isActive={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Monthly Sale Report/)).toBeInTheDocument();
    });

    const combobox = screen.getByRole('combobox', { name: 'เลือกโครงการ' });
    expect(combobox).toHaveValue('');

    // When combobox is set to 'ไอลิน 4'
    fireEvent.change(combobox, { target: { value: 'ไอลิน 4' } });
    expect(combobox).toHaveValue('ไอลิน 4');

    // When combobox is switched back to 'ทุกโครงการ' ('')
    fireEvent.change(combobox, { target: { value: '' } });
    expect(combobox).toHaveValue('');

    // Both projects must be included in the total summary
    await waitFor(() => {
      expect(screen.getAllByText(/นายธรรมนูญ พุ่มจำปา/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('correctly maps historical booking and transfer dates from leads instead of bulk import dates', async () => {
    render(<SalesDashboardExcelStyle isActive={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Monthly Sale Report/)).toBeInTheDocument();
    });

    // The line charts exist and render without crash
    expect(screen.getByText('ยอดโอน ปี 2023 - 2026 (หลัง)')).toBeInTheDocument();
    expect(screen.getByText('ยอดจอง ปี 2023 - 2026 (หลัง)')).toBeInTheDocument();
    expect(screen.getByText('ยอดเข้าชม ปี 2023 - 2026 (ครั้ง)')).toBeInTheDocument();

    // Cancelled lead (2026-10-07) is counted in ยอดลูกค้ายกเลิกสะสม (1)
    const cancelLabel = screen.getByText('ยอดลูกค้ายกเลิกสะสม');
    expect(cancelLabel.parentElement?.textContent).toContain('1');
    // Gross bookings in 2026 includes all bookings occurred in 2026 (2 active + 1 cancelled with booking_date in 2026 = 3)
    const bookedLabel = screen.getByText('ยอดลูกค้าจองสะสม');
    expect(bookedLabel.parentElement?.textContent).toContain('3');
  });
});
