import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CentralLeadBookingModal from '../CentralLeadBookingModal';

const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: {}, error: null })
});
const mockInsert = vi.fn().mockResolvedValue({ data: {}, error: null });

const mockPlotData = {
  id: 'A01',
  plot_number: 'A01',
  plot_name: 'แปลง A01',
  project_name: 'โครงการ สวนหลวง',
  house_type_id: 'ht-1',
  house_types: { type_name: 'บ้านเดี่ยวสองชั้น' },
  land_size: 55.5,
  selling_price: 2793000,
  sale_status: 'ready_for_sale',
  overview_image_url: 'https://example.com/house-a01.jpg'
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'leads') {
        return { update: mockUpdate };
      }
      if (table === 'lead_activities') {
        return { insert: mockInsert };
      }
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
      return {};
    })
  }
}));

vi.mock('@/lib/sales/plotAvailabilityClient', () => ({
  loadAvailablePlots: vi.fn().mockResolvedValue([
    { id: 'A01', project_name: 'โครงการ สวนหลวง', plot_name: 'แปลง A01', has_customer: false, sale_status: 'available' },
    { id: 'A02', project_name: 'โครงการ สวนหลวง', plot_name: 'แปลง A02', has_customer: false, sale_status: 'available' }
  ])
}));

describe('CentralLeadBookingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCustomer = {
    id: 'cust-123',
    name: 'คุณประสิทธิ์ ยอดเยี่ยม',
    phone: '089-999-8888',
    channel: 'Walk in',
    status: 'Visit',
    salesOwner: 'Sales Bell'
  };

  const mockOwners = [
    { userId: 'user-1', displayName: 'Sales Bell' },
    { userId: 'user-2', displayName: 'Sales Joy' }
  ];

  it('renders booking modal with customer information pre-filled', async () => {
    render(
      <CentralLeadBookingModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
      />
    );

    expect(screen.getByText(/บันทึกการจองแปลง \(Booking\)/)).toBeInTheDocument();
    expect(screen.getByText(/คุณประสิทธิ์ ยอดเยี่ยม/)).toBeInTheDocument();
    expect(screen.getByText(/089-999-8888/)).toBeInTheDocument();
    expect(screen.getByText(/ยืนยันการจองแปลง/)).toBeInTheDocument();
  });

  it('validates plot selection before booking', async () => {
    render(
      <CentralLeadBookingModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /ยืนยันการจองแปลง/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('กรุณาเลือกแปลงที่ต้องการจอง')).toBeInTheDocument();
    });
  });

  it('loads construction details, auto-fills list price, and calculates net selling price with discount', async () => {
    render(
      <CentralLeadBookingModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/แปลง A01/i)).toBeInTheDocument();
    });

    const plotSelect = screen.getByRole('combobox', { name: /แปลงที่จอง/i });
    fireEvent.change(plotSelect, { target: { value: 'A01' } });

    // Verify construction preview card rendered
    await waitFor(() => {
      expect(screen.getByText(/ข้อมูลจากฝ่ายก่อสร้าง \(แปลง แปลง A01\)/i)).toBeInTheDocument();
      expect(screen.getByText('บ้านเดี่ยวสองชั้น')).toBeInTheDocument();
      expect(screen.getByText('55.5 ตร.ว.')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    // Check that auto-filled list price matches 2,793,000
    const listPriceInput = screen.getByPlaceholderText(/เช่น 2,793,000/i);
    await waitFor(() => {
      expect((listPriceInput as HTMLInputElement).value).toBe('2,793,000');
    });

    // Enter discount: 100,000
    const discountInput = screen.getByPlaceholderText('0');
    fireEvent.change(discountInput, { target: { value: '100,000' } });

    // Check net price display: 2,793,000 - 100,000 = 2,693,000
    await waitFor(() => {
      expect(screen.getByText('฿2,693,000')).toBeInTheDocument();
    });
  });

  it('submits booking successfully with net price and triggers onSaved callback', async () => {
    const handleSaved = vi.fn();
    const handleClose = vi.fn();

    render(
      <CentralLeadBookingModal
        isOpen={true}
        onClose={handleClose}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
        onSaved={handleSaved}
      />
    );

    // Wait for plots to load and select A01
    await waitFor(() => {
      expect(screen.getByText(/แปลง A01/i)).toBeInTheDocument();
    });

    const plotSelect = screen.getByRole('combobox', { name: /แปลงที่จอง/i });
    fireEvent.change(plotSelect, { target: { value: 'A01' } });

    // Change deposit amount
    const depositInput = screen.getByPlaceholderText('10000');
    fireEvent.change(depositInput, { target: { value: '20000' } });

    const submitBtn = screen.getByRole('button', { name: /ยืนยันการจองแปลง/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
      expect(handleSaved).toHaveBeenCalledWith(
        expect.stringContaining('บันทึกการจองแปลง "A01"')
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
