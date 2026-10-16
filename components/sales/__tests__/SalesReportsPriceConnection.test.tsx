import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SalesReportsView from '../SalesReportsView';

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({
  fetchSalesWithoutLimit: vi.fn(async (table: string) => {
    if (table === 'plots') {
      return [
        {
          id: '6',
          plot_name: '6',
          selling_price: 4657000,
          land_appraisal_price: 0,
          project_name: 'ไอลิน6',
          highlight_note: 'ลูกค้า: นายธรรมนูญ พุ่มจำปา (จองแล้ว)'
        },
        {
          id: 'ไอลิน 3-19',
          plot_name: '19',
          selling_price: 2690000,
          land_appraisal_price: 2999000,
          project_name: 'ไอลิน 3',
          highlight_note: ''
        }
      ];
    }
    if (table === 'leads') {
      return [
        {
          id: 'lead-1',
          customer_name: 'นายธรรมนูญ พุ่มจำปา',
          project_name: 'ไอลิน6',
          status: 'Reserved',
          booking_date: '2026-10-02T05:00:00+00:00',
          interested_plot_id: '6',
          interested_plot_name: '6',
          notes: 'เช่าซื้อ, ซื้อพร้อมผู้เช่า · ที่ดิน 53.9 ตร.ว. · ราคา: 4,657,000 บ. · คาดโอน: ต.ค. 2569'
        },
        {
          id: 'lead-2',
          customer_name: 'น.ส.รัชฎา ภานุ',
          project_name: 'ไอลิน 3',
          status: 'Reserved',
          booking_date: '2026-10-05T05:00:00+00:00',
          interested_plot_id: 'ไอลิน 3-19',
          interested_plot_name: '19',
          notes: 'ที่ดิน 72.6 ตร.ว. · ราคา: 2,690,000 บ. · ราคาทด13: 2,999,000 บ.'
        }
      ];
    }
    if (table === 'sales') {
      return [];
    }
    return [];
  })
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] })
    }))
  }
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: () => null,
  Area: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

describe('SalesReportsView price and plot connections', () => {
  it('connects agreed selling price and land appraisal price for booked leads', async () => {
    render(<SalesReportsView project={null} viewType="reports" />);

    await waitFor(() => {
      expect(screen.getByText('นายธรรมนูญ พุ่มจำปา')).toBeInTheDocument();
    });

    // Customer 1: นายธรรมนูญ พุ่มจำปา
    // Plot: 6
    // Agreed sale price: 4,657,000
    // Appraisal price defaults to agreed sale price (4,657,000) when 0
    expect(screen.getByText('นายธรรมนูญ พุ่มจำปา')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();

    // Customer 2: น.ส.รัชฎา ภานุ
    // Plot: 19
    // Sale price: 2,690,000
    // Appraisal price: 2,999,000
    expect(screen.getByText('น.ส.รัชฎา ภานุ')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();

    // Verify prices are formatted and NOT ฿0
    const prices4657 = screen.getAllByText('฿4,657,000');
    expect(prices4657.length).toBeGreaterThan(0);

    const prices2690 = screen.getAllByText('฿2,690,000');
    expect(prices2690.length).toBeGreaterThan(0);

    const prices2999 = screen.getAllByText('฿2,999,000');
    expect(prices2999.length).toBeGreaterThan(0);
  });
});
