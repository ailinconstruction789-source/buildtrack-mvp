import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
});
