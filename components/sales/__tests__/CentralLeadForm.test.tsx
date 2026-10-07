import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CentralLeadForm from '../CentralLeadForm';

const mockPlots = [
  { id: 'plot-1', plot_name: 'A01', selling_price: 3000000, house_type: 'Type A' }
];

vi.mock('@/lib/sales/plotAvailabilityClient', () => ({
  loadAvailablePlots: vi.fn().mockResolvedValue([
    { id: 'plot-1', plot_name: 'A01', selling_price: 3000000, house_type: 'Type A' }
  ])
}));

const mockPlotData = {
  id: 'plot-1',
  plot_name: 'A01',
  project_name: 'โครงการ สวนหลวง',
  house_type_id: 'ht-1',
  house_types: { type_name: 'บ้านเดี่ยวสองชั้น' },
  land_size: 55.5,
  selling_price: 3000000,
  sale_status: 'ready_for_sale',
  overview_image_url: 'https://example.com/house-a01.jpg'
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'plots') {
        return { 
          update: vi.fn().mockReturnValue({ or: vi.fn().mockResolvedValue({}) }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockPlotData, error: null })
              })
            })
          })
        };
      }
      if (table === 'vw_plot_progress') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { overall_progress: 100 }, error: null })
            })
          })
        };
      }
      if (table === 'task_templates' || table === 'schedules' || table === 'plot_task_assignments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      };
    })
  }
}));

const USER = '00000000-0000-4000-8000-000000000001';

const mockSnapshot: any = {
  actor: { userId: USER, role: 'sales' },
  projects: [{ name: 'โครงการ สวนหลวง' }],
  salesOwners: [{ userId: USER, displayName: 'สมศรี มีทรัพย์' }]
};

describe('CentralLeadForm Direct Booking Integration', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('renders standard lead form without direct booking by default', () => {
    render(
      <CentralLeadForm 
        snapshot={mockSnapshot}
        save={vi.fn().mockResolvedValue({ customerId: 'c1', replayed: false })}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('บันทึก Lead ใหม่')).toBeInTheDocument();
    expect(screen.getByText('ลูกค้าเข้ามาเพื่อจองแปลงทันที (Direct Booking)')).toBeInTheDocument();
    expect(screen.queryByText('ข้อมูลการจองแปลงและราคา')).not.toBeInTheDocument();
  });

  it('toggles direct booking ON and loads available plots and pricing calculator', async () => {
    render(
      <CentralLeadForm 
        snapshot={mockSnapshot}
        save={vi.fn().mockResolvedValue({ customerId: 'c1', replayed: false })}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('ข้อมูลการจองแปลงและราคา')).toBeInTheDocument();
    });

    expect(screen.getByText('ราคาขายสุทธิหลังหักส่วนลด (Net Selling Price)')).toBeInTheDocument();
    expect(screen.getByText('เงินจองที่รับ (บาท)')).toBeInTheDocument();
  });

  it('submits lead with direct booking, auto-fills list price and calculates net discount', async () => {
    const saveMock = vi.fn().mockResolvedValue({ customerId: 'cust-100', replayed: false });
    const onSavedMock = vi.fn();

    render(
      <CentralLeadForm 
        snapshot={mockSnapshot}
        save={saveMock}
        onSaved={onSavedMock}
        onClose={vi.fn()}
      />
    );

    // Fill customer info
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้า/), { target: { value: 'คุณสมศักดิ์ น้อมรับ' } });
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0899998888' } });

    // Enable direct booking
    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByLabelText('แปลงที่จอง')).toBeInTheDocument();
    });

    // Select plot
    fireEvent.change(screen.getByLabelText('แปลงที่จอง'), { target: { value: 'plot-1' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('3,000,000')).toBeInTheDocument();
    });

    // Enter discount of 100,000
    const discountInput = screen.getByPlaceholderText('0');
    fireEvent.change(discountInput, { target: { value: '100000' } });

    // Net price should be 2,900,000
    await waitFor(() => {
      expect(screen.getByText('฿2,900,000')).toBeInTheDocument();
    });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /บันทึก Lead และยืนยันการจองแปลง/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
      expect(onSavedMock).toHaveBeenCalled();
    });
  });
});
