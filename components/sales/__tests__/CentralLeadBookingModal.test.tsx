import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CentralLeadBookingModal from '../CentralLeadBookingModal';

const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: {}, error: null })
});
const mockInsert = vi.fn().mockResolvedValue({ data: {}, error: null });
const mockConstruction = vi.hoisted(() => ({ withPlan: false, scheduleError: false }));

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
      if (table === 'sales') return { insert: (rows: { id: string }[]) => ({
        select: () => ({ single: async () => ({ data: { id: rows[0].id }, error: null }) })
      }) };
      if (table === 'plots') {
        return { 
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }),
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
      if (table === 'task_templates' || table === 'plot_task_schedules' || table === 'plot_task_assignments') {
        const data = !mockConstruction.withPlan ? [] : table === 'task_templates'
          ? [{ id: 'task-1', task_name: 'งานโครงสร้าง' }]
          : table === 'plot_task_schedules'
            ? [{ task_template_id: 'task-1', planned_start: '2020-01-01', planned_end: '2020-01-02' }]
            : [{ task_template_id: 'task-1', current_progress: 50 }];
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: table === 'plot_task_schedules' && mockConstruction.scheduleError ? null : data,
              error: table === 'plot_task_schedules' && mockConstruction.scheduleError ? { message: 'read failed' } : null
            })
          })
        };
      }
      if (table === 'plot_promotions') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }), delete: vi.fn().mockReturnValue({ or: vi.fn().mockResolvedValue({ error: null }) }), insert: vi.fn().mockResolvedValue({ error: null }) };
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
    mockConstruction.withPlan = false;
    mockConstruction.scheduleError = false;
    mockPlotData.sale_status = 'ready_for_sale';
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

  it('does not add a logged-in non-sales user back into the eligible closer options', async () => {
    render(<CentralLeadBookingModal isOpen onClose={vi.fn()} customer={mockCustomer}
      projects={['โครงการ สวนหลวง']} salesOwners={mockOwners}
      currentUser={{ userId: 'admin-1', displayName: 'Admin Test' }} />);
    const select = screen.getAllByRole('combobox').find(element =>
      within(element).queryByRole('option', { name: 'Sales Bell' }));
    expect(select).toBeDefined();
    expect(within(select!).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Sales Bell', 'Sales Joy']);
    expect(select).toHaveValue('Sales Bell');
    expect(screen.getByText('ระบุผู้ปิดการขายกำหนดเอง')).toBeInTheDocument();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not allow a fabricated staff name when no sales account is available', () => {
    render(<CentralLeadBookingModal isOpen onClose={vi.fn()} customer={mockCustomer}
      projects={['โครงการ สวนหลวง']} salesOwners={[]}
      currentUser={{ userId: 'admin-1', displayName: 'Admin Test' }} />);
    expect(screen.getByRole('option', { name: 'ไม่พบพนักงานฝ่ายขาย' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการจองแปลง/i }));
    expect(screen.getByText('กรุณาเลือกพนักงานฝ่ายขาย')).toBeInTheDocument();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

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

  it('uses the saved task schedule to show delayed construction instead of a zero-plan status', async () => {
    mockConstruction.withPlan = true;
    mockPlotData.sale_status = 'available';
    render(<CentralLeadBookingModal isOpen onClose={vi.fn()} customer={mockCustomer}
      projects={['โครงการ สวนหลวง']} salesOwners={mockOwners} />);
    await screen.findByRole('option', { name: 'แปลง A01 (แปลงว่าง)' });
    fireEvent.change(screen.getByRole('combobox', { name: /แปลงที่จอง/i }), { target: { value: 'A01' } });
    await screen.findByText('ล่าช้ากว่าแผน');
    expect(screen.queryByText('เร็วกว่าแผน')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/เช่น 2,793,000/i)).toHaveValue('2,793,000');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('shows a schedule read failure without inventing a construction status or losing the price', async () => {
    mockConstruction.withPlan = true;
    mockConstruction.scheduleError = true;
    mockPlotData.sale_status = 'available';
    render(<CentralLeadBookingModal isOpen onClose={vi.fn()} customer={mockCustomer}
      projects={['โครงการ สวนหลวง']} salesOwners={mockOwners} />);
    await screen.findByRole('option', { name: 'แปลง A01 (แปลงว่าง)' });
    fireEvent.change(screen.getByRole('combobox', { name: /แปลงที่จอง/i }), { target: { value: 'A01' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('ยังตรวจสอบสถานะเทียบแผนไม่ได้');
    expect(screen.queryByText('เร็วกว่าแผน')).not.toBeInTheDocument();
    expect(screen.queryByText('ล่าช้ากว่าแผน')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/เช่น 2,793,000/i)).toHaveValue('2,793,000');
    expect(mockUpdate).not.toHaveBeenCalled();
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

    await waitFor(() => expect(screen.getByPlaceholderText('เช่น 2,793,000')).toHaveValue('2,793,000'));

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
