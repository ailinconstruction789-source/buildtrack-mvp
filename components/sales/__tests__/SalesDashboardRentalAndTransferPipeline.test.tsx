import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SalesDashboardExcelStyle from '../SalesDashboardExcelStyle';

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({
  fetchSalesWithoutLimit: vi.fn(async (table: string) => {
    if (table === 'plots') {
      return [
        {
          id: 'plot-sale-waiting-1',
          plot_name: '10',
          selling_price: 3500000,
          land_appraisal_price: 3200000,
          project_name: 'ไอลิน6',
          sale_status: 'ready_for_sale'
        },
        {
          id: 'plot-yorio-35',
          plot_name: '35',
          selling_price: 2500000,
          land_appraisal_price: 2000000,
          project_name: 'โยริว',
          sale_status: 'ready_for_sale'
        },
        {
          id: 'plot-yorio-42',
          plot_name: '42',
          selling_price: 2600000,
          land_appraisal_price: 2100000,
          project_name: 'โยริว',
          sale_status: 'ready_for_sale'
        },
        {
          id: 'plot-ailin6-44',
          plot_name: '44',
          selling_price: 3000000,
          land_appraisal_price: 2800000,
          project_name: 'ไอลิน6',
          sale_status: 'ready_for_sale'
        }
      ];
    }
    if (table === 'leads') {
      return [
        {
          id: 'lead-sale-1',
          customer_name: 'คุณสมชาย ใจดี',
          project_name: 'ไอลิน6',
          status: 'Reserved',
          deal_type: 'sale',
          booking_date: '2026-10-05T05:00:00+00:00',
          interested_plot_id: 'plot-sale-waiting-1',
          interested_plot_name: '10',
          expected_transfer_date: '2026-10-28',
          notes: 'รอโอนปลายเดือน ต.ค. 2569'
        },
        {
          id: 'lead-rent-oct-contracted',
          customer_name: 'บจก.อาร์ติแฟคท์',
          project_name: 'โยริว',
          status: 'Rented',
          deal_type: 'rent',
          rental_status: 'Active',
          rental_start_date: '2026-10-01',
          contract_date: '2026-10-01',
          interested_plot_id: 'plot-yorio-35',
          interested_plot_name: '35',
          notes: 'ทำสัญญาเช่า 1 ต.ค. 69'
        },
        {
          id: 'lead-rent-pending',
          customer_name: 'คุณวิชัย ลูกค้าเช่า',
          project_name: 'โยริว',
          status: 'Reserved',
          deal_type: 'rent',
          rental_status: 'PendingContract',
          booking_date: '2026-10-10T05:00:00+00:00',
          interested_plot_id: 'plot-yorio-42',
          interested_plot_name: '42',
          notes: 'รอทำสัญญาเช่า'
        },
        {
          id: 'lead-rent-prior-active',
          customer_name: 'คุณนภา ผู้เช่าเก่า',
          project_name: 'ไอลิน6',
          status: 'Rented',
          deal_type: 'rent',
          rental_status: 'Active',
          rental_start_date: '2026-07-01',
          contract_date: '2026-07-01',
          interested_plot_id: 'plot-ailin6-44',
          interested_plot_name: '44',
          notes: 'เริ่มเช่า ก.ค. 69'
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
          data: table === 'projects' ? [{ id: 'p1', name: 'ไอลิน6', is_closed: false }, { id: 'p2', name: 'โยริว', is_closed: false }] : [],
          error: null
        })),
        then: vi.fn((resolve: (val: any) => void) => {
          if (table === 'projects') {
            resolve({ data: [{ id: 'p1', name: 'ไอลิน6', is_closed: false }, { id: 'p2', name: 'โยริว', is_closed: false }], error: null });
          } else if (table === 'rental_contracts') {
            resolve({
              data: [
                {
                  id: 'rc-yorio-35',
                  plot_id: 'plot-yorio-35',
                  plot_name: '35',
                  project_name: 'โยริว',
                  status: 'Active',
                  lease_start_date: '2026-10-01',
                  tenant_name: 'บจก.อาร์ติแฟคท์'
                },
                {
                  id: 'rc-ailin-44',
                  plot_id: 'plot-ailin6-44',
                  plot_name: '44',
                  project_name: 'ไอลิน6',
                  status: 'Active',
                  lease_start_date: '2026-07-01',
                  tenant_name: 'คุณนภา ผู้เช่าเก่า'
                }
              ],
              error: null
            });
          } else {
            resolve({ data: [], error: null });
          }
        })
      }))
    })),
    rpc: vi.fn(async () => ({
      data: null,
      error: { message: 'CRM_PROJECT_SALES_SETUP_REQUIRED' }
    }))
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

describe('SalesDashboard Card 3 Pipeline - Sales vs Rental Separation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly separates monthly sales transfers from rental contracts and pending bookings', async () => {
    render(<SalesDashboardExcelStyle isActive={true} />);

    await waitFor(() => {
      expect(screen.getByText(/ภาพรวมการโอน & สัญญาเดือนนี้/)).toBeInTheDocument();
    });

    // 1. Sales Side: No sales transferred this month (โอนแล้ว: 0), 1 sale waiting (รอโอน: 1)
    expect(screen.getByText(/🏡 ฝั่งขายบ้าน \(กรรมสิทธิ์\)/)).toBeInTheDocument();
    
    // Look for transfer status badges
    await waitFor(() => {
      expect(screen.getByText(/โอนแล้ว \(0\)/)).toBeInTheDocument();
      expect(screen.getByText(/รอโอน \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/• ไอลิน6-10/)).toBeInTheDocument();
    });

    // 2. Rental Side: 1 contract signed this month (โยริว-35), 1 pending booking (โยริว-42)
    // Prior active lease (ไอลิน6-44 from July) should NOT appear in ทำสัญญาเดือนนี้ or จองเช่า
    expect(screen.getByText(/🔑 ฝั่งบ้านเช่า \(Ailin Rental\)/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/ทำสัญญา \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/จองเช่า \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/• โยริว-35/)).toBeInTheDocument();
      expect(screen.getByText(/• โยริว-42/)).toBeInTheDocument();
      // Prior active lease from July 2026 must not be listed in current month's contract list or pending list
      expect(screen.queryByText(/• ไอลิน6-44/)).toBeNull();
    });
  });
});
