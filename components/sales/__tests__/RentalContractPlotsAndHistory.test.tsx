import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RentalContractModal from '../RentalContractModal';

const mocks = vi.hoisted(() => ({
  from: vi.fn()
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from }
}));

vi.mock('../LeadPicker', () => ({
  default: () => <div data-testid="lead-picker-stub" />
}));

describe('RentalContractModal - Plot ordering, Booked plots & Historical dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sorts plots in natural numerical order and shows booked plots with 🟡 ติดจอง', async () => {
    const mockPlots = [
      { id: 'p10', plot_name: 'แปลง 10', sale_status: 'Available', has_customer: false, price: 3000000, project_name: 'ไอลิน สันทราย 2' },
      { id: 'p2', plot_name: 'แปลง 2', sale_status: 'Booked', has_customer: true, price: 2800000, project_name: 'ไอลิน สันทราย 2' },
      { id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 2500000, project_name: 'ไอลิน สันทราย 2' },
      { id: 'p20', plot_name: 'แปลง 20', sale_status: 'Transferred', has_customer: true, price: 3200000, project_name: 'ไอลิน สันทราย 2' },
    ];

    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockPlots, error: null })
          })
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        user={{ displayName: 'Sales Person' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Person' }]}
      />
    );

    // Wait for plots to load
    await waitFor(() => {
      expect(screen.getByText(/-- เลือกแปลงบ้าน \(เรียงตามลำดับเลขแปลง\) --/i)).toBeInTheDocument();
    });

    const options = screen.getAllByRole('option');
    const plotOptions = options.filter(o => o.getAttribute('value')?.startsWith('p'));
    
    // Natural order check: แปลง 1, แปลง 2, แปลง 10 (แปลง 20 is transferred so excluded)
    expect(plotOptions.map(o => o.getAttribute('value'))).toEqual(['p1', 'p2', 'p10']);

    // Check status tags
    const optP1 = plotOptions.find(o => o.getAttribute('value') === 'p1');
    const optP2 = plotOptions.find(o => o.getAttribute('value') === 'p2');
    const optP10 = plotOptions.find(o => o.getAttribute('value') === 'p10');

    expect(optP1?.textContent).toContain('🟢 ว่าง');
    expect(optP1?.hasAttribute('disabled')).toBe(false);

    expect(optP2?.textContent).toContain('🟡 ติดจอง');
    expect(optP2?.hasAttribute('disabled')).toBe(true);

    expect(optP10?.textContent).toContain('🟢 ว่าง');
    expect(optP10?.hasAttribute('disabled')).toBe(false);
  });

  it('allows booked lead to select their own booked plot', async () => {
    const mockPlots = [
      { id: 'p2', plot_name: 'แปลง 2', sale_status: 'Booked', has_customer: true, customer_name: 'คุณสมชาย', price: 2800000, project_name: 'ไอลิน สันทราย 2' },
      { id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 2500000, project_name: 'ไอลิน สันทราย 2' },
    ];

    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockPlots, error: null })
          })
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });

    const bookedLead = {
      id: 'lead-123',
      customer_name: 'คุณสมชาย',
      phone: '0812345678',
      interested_plot_id: 'p2',
      status: 'booked',
      crm_status: 'จองแปลง 2 — วางเงินมัดจำ',
      booking_date: '2026-08-15T00:00:00.000Z',
      deal_type: 'rent'
    };

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        lead={bookedLead as any}
        user={{ displayName: 'Sales Person' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Person' }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/-- เลือกแปลงบ้าน \(เรียงตามลำดับเลขแปลง\) --/i)).toBeInTheDocument();
    });

    const options = screen.getAllByRole('option');
    const optP2 = options.find(o => o.getAttribute('value') === 'p2');

    expect(optP2?.textContent).toContain('🟡 ติดจอง (แปลงของลูกค้ารายนี้)');
    // Should NOT be disabled because it belongs to this booked customer!
    expect(optP2?.hasAttribute('disabled')).toBe(false);

    // Verify date and booking inputs for historical data entry are rendered
    expect(screen.getByLabelText(/วันที่จอง/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/เงินจอง \/ มัดจำ/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/วันที่ทำสัญญา/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/วันเริ่มต้นสัญญา/i)).toBeInTheDocument();
  });

  it('renders agreed house price and deduction summary when Program B is active', async () => {
    const mockPlots = [
      { id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 3000000, project_name: 'ไอลิน สันทราย 2' },
    ];

    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockPlots, error: null })
          })
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });

    const leadProgramB = {
      id: 'lead-b',
      customer_name: 'คุณสุชาติ',
      phone: '0899999999',
      interested_plot_id: 'p1',
      rental_program: 'program_b',
      booking_amount: 10000,
      deal_type: 'rent'
    };

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        lead={leadProgramB as any}
        user={{ displayName: 'Sales Person' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Person' }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/ราคาบ้านที่ตกลงซื้อขาย/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/เงินสะสมเพื่อซื้อบ้านรายเดือน/i)).toBeInTheDocument();
    expect(screen.getByText(/สรุปการหักเงินดาวน์สะสม ณ วันโอนกรรมสิทธิ์/i)).toBeInTheDocument();
    expect(screen.getByText(/ยอดกู้\/ชำระวันโอน/i)).toBeInTheDocument();
  });

  it('automatically pulls the lead original salesperson as default closer even when opened by Admin', async () => {
    mocks.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    }));

    const leadWithSales = {
      id: 'lead-nan',
      customer_name: 'คุณมานะ',
      phone: '0811112222',
      agent_name: 'น้องแนน ฝ่ายขาย',
      status: 'booked'
    };

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        lead={leadWithSales as any}
        user={{ displayName: 'ผู้จัดการ Admin', username: 'admin' }}
        salesOwners={[
          { userId: 'u-admin', displayName: 'ผู้จัดการ Admin' },
          { userId: 'u-nan', displayName: 'น้องแนน ฝ่ายขาย' }
        ]}
      />
    );

    // Should automatically select the original salesperson 'น้องแนน ฝ่ายขาย' instead of Admin
    await waitFor(() => {
      expect(screen.getByText(/เซลล์เดิมที่ดูแลลูกค้า \(ดึงให้อัตโนมัติ\)/i)).toBeInTheDocument();
    });

    const agentSelect = screen.getByRole('combobox', { name: /ผู้บันทึกสัญญา \/ เซลล์ผู้ดูแล/i });
    expect((agentSelect as HTMLSelectElement).value).toBe('น้องแนน ฝ่ายขาย');
  });

  it('allows switching to Rental Booking (จองเช่า) mode and renders booking confirmation UI', async () => {
    mocks.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    }));

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]}
      />
    );

    // Header and button should show Rental Booking (จองเช่า)
    expect(screen.getByText(/วางเงินจองเช่า \/ ล็อกแปลง \(Rental Booking\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ยืนยันบันทึกการจองเช่า \(ล็อกแปลง\)/i })).toBeInTheDocument();

    // Clicking contract mode switches header and button to Lease Contract
    const contractTab = screen.getByRole('button', { name: /ทำสัญญาเช่าจริง/i });
    fireEvent.click(contractTab);

    expect(screen.getByText(/ทำสัญญาเช่า \/ เช่าออม \(Ailin Rental\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/i })).toBeInTheDocument();
  });

  it('deducts paid booking deposit from total initial payment on contract signing', async () => {
    mocks.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    }));

    const leadWithBookingDeposit = {
      id: 'lead-booked',
      customer_name: 'คุณประสิทธิ์',
      phone: '0855556666',
      booking_amount: 5000,
      deal_type: 'rent',
      status: 'Reserved'
    };

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        lead={leadWithBookingDeposit as any}
        defaultMode="contract"
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]}
      />
    );

    // Verify booking deduction is displayed in the payment summary
    expect(screen.getByText(/หักเงินจองเช่าที่ชำระแล้ว:/i)).toBeInTheDocument();
    expect(screen.getByText(/-5,000 บาท/i)).toBeInTheDocument();
    expect(screen.getByText(/ยอดสุทธิที่ต้องชำระวันสัญญา/i)).toBeInTheDocument();
  });

  it('renders only booking essentials in booking mode and hides contract date, deposit, and advance rent', async () => {
    mocks.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    }));

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]}
      />
    );

    // In booking mode: essential booking inputs must be present
    expect(screen.getByLabelText(/วันที่วางเงินจอง/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ยอดเงินจองเช่า \/ ล็อกแปลง/i)).toBeInTheDocument();
    const bookingStartDateInput = screen.getByLabelText(/วันที่นัดทำสัญญา \/ คาดว่าจะเข้าอยู่/i) as HTMLInputElement;
    expect(bookingStartDateInput).toBeInTheDocument();
    // Booking start date must be optional (NOT required)
    expect(bookingStartDateInput.required).toBe(false);

    expect(screen.getByLabelText(/ค่าเช่าต่อเดือนโดยประมาณ/i)).toBeInTheDocument();

    // Contract-specific inputs must NOT be in booking mode
    expect(screen.queryByLabelText(/วันที่ทำสัญญา \(Contract Date\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^เงินประกันบ้าน$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /เก็บค่าเช่าล่วงหน้า/i })).not.toBeInTheDocument();

    // Switch to contract mode
    const contractTab = screen.getByRole('button', { name: /ทำสัญญาเช่าจริง/i });
    fireEvent.click(contractTab);

    // Now contract-specific inputs must be present and required
    const contractDateInput = screen.getByLabelText(/วันที่ทำสัญญา \(Contract Date\)/i) as HTMLInputElement;
    expect(contractDateInput).toBeInTheDocument();
    expect(contractDateInput.required).toBe(true);

    const contractStartDateInput = screen.getByLabelText(/วันเริ่มต้นสัญญา \(Start Date\)/i) as HTMLInputElement;
    expect(contractStartDateInput).toBeInTheDocument();
    expect(contractStartDateInput.required).toBe(true);

    expect(screen.getByLabelText(/^เงินประกันบ้าน$/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /เก็บค่าเช่าล่วงหน้า/i })).toBeInTheDocument();
  });

  it('allows arbitrary decimal numbers with step="any" without integer step constraints', async () => {
    mocks.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    }));

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]}
      />
    );

    const bookingAmountInput = screen.getByLabelText(/ยอดเงินจองเช่า \/ ล็อกแปลง/i) as HTMLInputElement;
    const monthlyRentInput = screen.getByLabelText(/ค่าเช่าต่อเดือนโดยประมาณ/i) as HTMLInputElement;

    // Must have step="any"
    expect(bookingAmountInput.getAttribute('step')).toBe('any');
    expect(monthlyRentInput.getAttribute('step')).toBe('any');

    // Input exact decimal value from user's case: 35789.47
    fireEvent.change(bookingAmountInput, { target: { value: '35789.47' } });
    fireEvent.change(monthlyRentInput, { target: { value: '35789.47' } });

    expect(bookingAmountInput.value).toBe('35789.47');
    expect(monthlyRentInput.value).toBe('35789.47');

    // Payment summary must show the exact decimal formatted
    expect(screen.getByText(/35,789.47 บาท/i)).toBeInTheDocument();
  });

  it('submits rental booking successfully without non-existent columns', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    let leadsPayload: any = null;
    let plotsUpdatedPayload: any = null;

    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 2500000 }],
              error: null
            })
          }),
          update: vi.fn().mockImplementation((payload: any) => {
            plotsUpdatedPayload = payload;
            return {
              eq: vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null })
            };
          })
        };
      }
      if (table === 'leads') {
        return {
          update: vi.fn().mockImplementation((payload: any) => {
            leadsPayload = payload;
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null })
            };
          }),
          insert: vi.fn().mockImplementation((payload: any[]) => {
            leadsPayload = payload[0];
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'lead-new' }, error: null })
              })
            };
          })
        };
      }
      if (table === 'status_history') {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      };
    });

    render(
      <RentalContractModal
        isOpen
        onClose={onClose}
        onSaved={onSaved}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'lead-test-1',
          customer_name: 'คุณสมศักดิ์ จองเช่า',
          phone: '0812345678',
          project_name: 'ไอลิน สันทราย 2',
          sales_owner: 'Sales Rep',
          created_at: '2026-10-17T00:00:00.000Z'
        } as any}
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]}
      />
    );

    // Wait for plots to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/กำลังโหลดแปลง.../i)).not.toBeInTheDocument();
    });

    // Submit booking
    const submitBtn = screen.getByRole('button', { name: /ยืนยันบันทึกการจองเช่า \(ล็อกแปลง\)/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      expect(onSaved).toHaveBeenCalled();
    });

    // Check payload sent to leads: must NOT contain expected_transfer_date
    expect(leadsPayload).toBeDefined();
    expect(leadsPayload.expected_transfer_date).toBeUndefined();
    expect(leadsPayload.deal_type).toBe('rent');
    expect(leadsPayload.status).toBe('Reserved');

    // Check payload sent to plots: must NOT contain customer_name
    expect(plotsUpdatedPayload).toBeDefined();
    expect(plotsUpdatedPayload.customer_name).toBeUndefined();
    expect(plotsUpdatedPayload.current_tenant_name).toBe('คุณสมศักดิ์ จองเช่า');
    expect(plotsUpdatedPayload.sale_status).toBe('Booked');
  });

  it('preserves user-input monthly rent and does not reset to 15000 on props or background re-renders', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 2500000, monthly_rent: 18000 }],
              error: null
            })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      };
    });

    const { rerender } = render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'lead-test-2',
          customer_name: 'คุณวิชัย',
          phone: '0899999999',
          project_name: 'ไอลิน สันทราย 2',
          rental_monthly_rent: 22000,
          created_at: '2026-10-17T00:00:00.000Z'
        } as any}
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[]}
      />
    );

    // Should load the lead's rental_monthly_rent (22000), not the 15000 default
    const monthlyRentInput = screen.getByLabelText(/ค่าเช่าต่อเดือนโดยประมาณ/i) as HTMLInputElement;
    expect(monthlyRentInput.value).toBe('22000');

    // User edits the monthly rent to 28500
    fireEvent.change(monthlyRentInput, { target: { value: '28500' } });
    expect(monthlyRentInput.value).toBe('28500');

    // Simulate async salesOwners loaded in background and re-render parent with new array and user object
    rerender(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'lead-test-2',
          customer_name: 'คุณวิชัย',
          phone: '0899999999',
          project_name: 'ไอลิน สันทราย 2',
          rental_monthly_rent: 22000,
          created_at: '2026-10-17T00:00:00.000Z'
        } as any}
        user={{ displayName: 'Sales Rep' }} // new object reference
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]} // newly loaded salesOwners
      />
    );

    // Must NOT revert to 15000 or 22000; must stay 28500
    expect(monthlyRentInput.value).toBe('28500');
  });

  it('initializes startDate (วันที่นัดทำสัญญา/เข้าอยู่) as empty string in booking mode when not specified by lead', () => {
    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'lead-test-new-booking',
          customer_name: 'คุณนพดล',
          phone: '0812345678',
          project_name: 'ไอลิน สันทราย 2',
          rental_monthly_rent: 18000,
          created_at: '2026-10-19T00:00:00.000Z'
        } as any}
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[]}
      />
    );

    // Expected move-in/contract date in booking mode should be empty string
    const startDateInput = screen.getByLabelText(/วันที่นัดทำสัญญา \/ คาดว่าจะเข้าอยู่/i) as HTMLInputElement;
    expect(startDateInput.value).toBe('');
  });

  it('renders prior saved booking data preview banner when lead was already booked', () => {
    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'lead-test-prior-booking',
          customer_name: 'คุณพรชัย',
          phone: '0855555555',
          project_name: 'ไอลิน สันทราย 2',
          status: 'Reserved',
          booking_amount: 25000,
          booking_date: '2026-10-15T00:00:00.000Z',
          rental_monthly_rent: 20000,
          rental_start_date: '2026-11-01',
          interested_plot_name: 'A-01',
          agent_name: 'คุณสมชาย',
          created_at: '2026-10-15T00:00:00.000Z'
        } as any}
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[]}
      />
    );

    // Preview banner should be visible
    expect(screen.getByText(/ข้อมูลการจองเดิมในระบบ \(บันทึกไว้แล้ว\)/i)).toBeInTheDocument();
    expect(screen.getByText(/บันทึกซ้ำจะอัปเดตทับข้อมูลนี้ \(ไม่นับเป็นจองซ้ำ\)/i)).toBeInTheDocument();
    expect(screen.getByText(/ยอดเงินจองเดิม/i)).toBeInTheDocument();
    expect(screen.getByText(/วันที่วางเงินจองเดิม/i)).toBeInTheDocument();
    expect(screen.getByText(/ค่าเช่าต่อเดือนเดิม/i)).toBeInTheDocument();
    expect(screen.getByText(/วันนัดทำสัญญา\/เข้าอยู่เดิม/i)).toBeInTheDocument();
    expect(screen.getAllByText(/25,000/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2026-10-15')).toBeInTheDocument();
    expect(screen.getByText('20,000 บ./ด.')).toBeInTheDocument();
    expect(screen.getByText('2026-11-01')).toBeInTheDocument();
  });

  it('renders first-time booking badge when lead has no prior booking data', () => {
    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'lead-test-brand-new',
          customer_name: 'คุณใหม่',
          phone: '0866666666',
          project_name: 'ไอลิน สันทราย 2',
          created_at: '2026-10-19T00:00:00.000Z'
        } as any}
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[]}
      />
    );

    expect(screen.getByText(/การวางเงินจองใหม่ครั้งแรก/i)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มีข้อมูลการจองเดิมในระบบ/i)).toBeInTheDocument();
  });

  it('correctly populates and saves bookingDate from bookingDate or booking_date aliases', async () => {
    let savedPayload: any = null;
    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'p1', plot_name: 'A-01', sale_status: 'Available' }],
              error: null
            })
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        };
      }
      if (table === 'leads') {
        return {
          update: vi.fn().mockImplementation((payload: any) => {
            savedPayload = payload;
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null })
            };
          })
        };
      }
      if (table === 'sales') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: null })
      };
    });

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="booking"
        plotId="p1"
        lead={{
          id: 'sale-999',
          leadId: 'lead-real-999',
          customer_name: 'คุณชัยวัฒน์',
          phone: '0877777777',
          project_name: 'ไอลิน สันทราย 2',
          bookingDate: '2026-10-12',
          booking_amount: 15000,
          rental_monthly_rent: 18000,
          sales_owner: 'Sales Rep'
        } as any}
        user={{ displayName: 'Sales Rep' }}
        salesOwners={[{ userId: 'u1', displayName: 'Sales Rep' }]}
      />
    );

    // booking date input should be populated from lead.bookingDate
    const bookingDateInput = screen.getByLabelText(/วันที่วางเงินจอง/i) as HTMLInputElement;
    expect(bookingDateInput.value).toBe('2026-10-12');

    // Wait for plots to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/กำลังโหลดแปลง.../i)).not.toBeInTheDocument();
    });

    // User changes booking date to 2026-10-14
    fireEvent.change(bookingDateInput, { target: { value: '2026-10-14' } });
    expect(bookingDateInput.value).toBe('2026-10-14');

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /ยืนยันบันทึกการจองเช่า \(ล็อกแปลง\)/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(savedPayload).toBeDefined();
    });

    expect(savedPayload.booking_date).toBe('2026-10-14T00:00:00.000Z');
  });

  it('allows a customer who previously booked rental (PendingContract / จองเช่า) to sign actual rental contract without false stage blocking', async () => {
    let contractPayload: any = null;
    let leadUpdatePayload: any = null;
    let statusHistoryPayload: any = null;

    mocks.from.mockImplementation((table: string) => {
      if (table === 'status_history') {
        return {
          insert: vi.fn().mockImplementation((payload) => {
            statusHistoryPayload = payload[0];
            return Promise.resolve({ data: null, error: null });
          })
        };
      }
      if (table === 'plots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: 'p35', plot_name: 'แปลง 35', sale_status: 'Booked', has_customer: true, customer_name: 'บจก.อาร์ติแพคท์', selling_price: 2086000, monthly_rent: 15000, project_name: 'โยริว' }
              ],
              error: null
            })
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        };
      }
      if (table === 'rental_contracts') {
        const inPromise = Promise.resolve({ data: [], error: null });
        (inPromise as any).limit = vi.fn().mockResolvedValue({ data: [], error: null });
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue(inPromise)
            })
          }),
          insert: vi.fn().mockImplementation((payload) => {
            contractPayload = payload[0];
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'contract-artipact-1' }, error: null })
              })
            };
          })
        };
      }
      if (table === 'leads') {
        const chain: any = {
          neq: vi.fn().mockResolvedValue({ data: [], error: null }),
          single: vi.fn().mockResolvedValue({ data: { id: 'lead-artipact' }, error: null })
        };
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.in = vi.fn().mockReturnValue(chain);
        return {
          select: vi.fn().mockReturnValue(chain),
          update: vi.fn().mockImplementation((payload) => {
            leadUpdatePayload = payload;
            return {
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'lead-artipact' }, error: null })
                })
              })
            };
          })
        };
      }
      if (table === 'sales') {
        const chain: any = {
          neq: vi.fn().mockResolvedValue({ data: [], error: null })
        };
        chain.eq = vi.fn().mockReturnValue(chain);
        return {
          select: vi.fn().mockReturnValue(chain),
          update: vi.fn().mockReturnValue(chain)
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });

    const bookedLead = {
      id: 'lead-artipact',
      customer_name: 'บจก.อาร์ติแพคท์',
      phone: '0812345678',
      project_name: 'โยริว',
      status: 'Reserved',
      crm_status: 'จองเช่า — รอทำสัญญา (แบบ A)',
      deal_type: 'rent',
      rental_program: 'program_a',
      rental_status: 'PendingContract',
      interested_plot_id: 'p35',
      booking_date: '2026-10-15T00:00:00.000Z',
      booking_amount: 5000,
      rental_monthly_rent: 15000,
      sales_owner: 'NOOK'
    };

    render(
      <RentalContractModal
        isOpen
        onClose={vi.fn()}
        defaultMode="contract"
        plotId="p35"
        lead={bookedLead as any}
        user={{ displayName: 'NOOK' }}
        salesOwners={[{ userId: 'u-nook', displayName: 'NOOK' }]}
      />
    );

    // Wait for plots to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/กำลังโหลดแปลง.../i)).not.toBeInTheDocument();
    });

    // Make sure the error banner is NOT present
    expect(screen.queryByText(/ลูกค้ารายนี้อยู่ในขั้นตอนจอง โอน เช่า/i)).not.toBeInTheDocument();

    // Click submit "ยืนยันบันทึกสัญญาเช่า"
    const submitBtn = screen.getByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/i });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    // Wait for insertion
    await waitFor(() => {
      expect(contractPayload).toBeDefined();
    });

    // Verify contract created with deducted booking amount note and correct lead ID
    expect(contractPayload.lead_id).toBe('lead-artipact');
    expect(contractPayload.tenant_name).toBe('บจก.อาร์ติแพคท์');
    expect(contractPayload.status).toBe('Active');

    // Verify lead status updated to Rented & Active
    expect(leadUpdatePayload).toBeDefined();
    expect(leadUpdatePayload.status).toBe('Rented');
    expect(leadUpdatePayload.rental_status).toBe('Active');
    // Verify status_history was logged with contract timestamp
    expect(statusHistoryPayload).toBeDefined();
    expect(statusHistoryPayload.new_status).toBe('Rented');
    expect(statusHistoryPayload.created_at).toBeDefined();
    expect(statusHistoryPayload.changed_by).toContain('ทำสัญญาเช่า (NOOK)');
  });
});




