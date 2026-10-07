import { describe, it, expect } from 'vitest';
import { 
  generateMonthlyPaymentSchedule, 
  calculateRentalPaymentSummary 
} from '@/lib/rentalHelper';
import { RentalContract, RentalPaymentRecord } from '@/types/sales';

describe('Ailin Rental Payments Helper & Ledger Engine', () => {
  const mockContractB: RentalContract = {
    id: 'contract-b-1',
    lead_id: 'lead-1',
    plot_id: 'plot-32',
    plot_name: '32',
    project_name: 'ไอลิน สันทราย 2',
    tenant_name: 'สมชาย รักบ้าน',
    tenant_phone: '0812345678',
    agent_name: 'Bell',
    program_type: 'program_b',
    monthly_rent: 15000,
    security_deposit: 30000,
    advance_rent: 15000,
    savings_per_month: 5000,
    accumulated_savings: 10000,
    base_price: 2990000,
    lease_duration_months: 12,
    lease_start_date: '2026-01-01',
    lease_end_date: '2026-12-31',
    status: 'Active',
    created_at: '2026-01-01T00:00:00Z'
  };

  describe('generateMonthlyPaymentSchedule', () => {
    it('generates a full 12-month schedule when no payments have been recorded', () => {
      const schedule = generateMonthlyPaymentSchedule(mockContractB, []);

      expect(schedule).toHaveLength(12);
      expect(schedule[0].period_month).toBe(1);
      expect(schedule[0].period_label).toContain('งวดที่ 1');
      expect(schedule[0].due_date).toBe('2026-01-01');
      expect(schedule[0].amount_due).toBe(15000);
      expect(schedule[0].savings_amount).toBe(5000);
      expect(schedule[11].period_month).toBe(12);
      expect(schedule[11].period_label).toContain('งวดที่ 12');
      expect(schedule[11].due_date).toBe('2026-12-01');
    });

    it('correctly maps existing payments from database to the installment schedule', () => {
      const existingPayments: RentalPaymentRecord[] = [
        {
          id: 'pay-1',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          plot_name: '32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_month: 1,
          period_label: 'งวดที่ 1',
          due_date: '2026-01-01',
          amount_due: 15000,
          amount_paid: 15000,
          savings_amount: 5000,
          payment_status: 'Paid',
          paid_date: '2026-01-01T10:00:00Z',
          payment_method: 'transfer',
          slip_url: 'https://example.com/slip1.jpg',
          recorded_by: 'Bell',
          created_at: '2026-01-01T10:00:00Z'
        },
        {
          id: 'pay-2',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          plot_name: '32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_month: 2,
          period_label: 'งวดที่ 2',
          due_date: '2026-02-01',
          amount_due: 15000,
          amount_paid: 15000,
          savings_amount: 5000,
          payment_status: 'Paid',
          paid_date: '2026-02-02T10:00:00Z',
          payment_method: 'transfer',
          recorded_by: 'Bell',
          created_at: '2026-02-02T10:00:00Z'
        }
      ];

      const schedule = generateMonthlyPaymentSchedule(mockContractB, existingPayments);

      expect(schedule[0].payment_status).toBe('Paid');
      expect(schedule[0].amount_paid).toBe(15000);
      expect(schedule[0].slip_url).toBe('https://example.com/slip1.jpg');

      expect(schedule[1].payment_status).toBe('Paid');
      expect(schedule[1].amount_paid).toBe(15000);

      // Period 3 onwards are not paid yet
      expect(schedule[2].period_month).toBe(3);
      expect(schedule[2].amount_paid).toBe(0);
    });
  });

  describe('calculateRentalPaymentSummary', () => {
    it('accurately calculates paid, pending, overdue counts, totals and Program B savings', () => {
      const schedule: RentalPaymentRecord[] = [
        {
          id: 'pay-1',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_label: 'งวดที่ 1',
          period_month: 1,
          due_date: '2026-01-01',
          amount_due: 15000,
          amount_paid: 15000,
          savings_amount: 5000,
          payment_status: 'Paid'
        },
        {
          id: 'pay-2',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_label: 'งวดที่ 2',
          period_month: 2,
          due_date: '2026-02-01',
          amount_due: 15000,
          amount_paid: 15000,
          savings_amount: 5000,
          payment_status: 'Paid'
        },
        {
          id: 'pay-3',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_label: 'งวดที่ 3',
          period_month: 3,
          due_date: '2026-03-01',
          amount_due: 15000,
          amount_paid: 0,
          savings_amount: 5000,
          payment_status: 'Overdue'
        },
        {
          id: 'pay-4',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_label: 'งวดที่ 4',
          period_month: 4,
          due_date: '2026-04-01',
          amount_due: 15000,
          amount_paid: 0,
          savings_amount: 5000,
          payment_status: 'Pending'
        }
      ];

      const summary = calculateRentalPaymentSummary(schedule);

      expect(summary.totalPeriods).toBe(4);
      expect(summary.paidPeriods).toBe(2);
      expect(summary.pendingPeriods).toBe(1);
      expect(summary.overduePeriods).toBe(1);
      expect(summary.hasOverdue).toBe(true);

      expect(summary.totalAmountDue).toBe(60000);
      expect(summary.totalAmountPaid).toBe(30000);
      expect(summary.totalRemaining).toBe(30000);
      expect(summary.totalAccumulatedSavings).toBe(10000); // 5000 * 2 paid periods
    });

    it('returns zero savings if none of the periods have been paid', () => {
      const schedule: RentalPaymentRecord[] = [
        {
          id: 'pay-1',
          contract_id: 'contract-b-1',
          plot_id: 'plot-32',
          project_name: 'ไอลิน สันทราย 2',
          tenant_name: 'สมชาย รักบ้าน',
          period_label: 'งวดที่ 1',
          period_month: 1,
          due_date: '2026-01-01',
          amount_due: 15000,
          amount_paid: 0,
          savings_amount: 5000,
          payment_status: 'Pending'
        }
      ];

      const summary = calculateRentalPaymentSummary(schedule);
      expect(summary.paidPeriods).toBe(0);
      expect(summary.totalAccumulatedSavings).toBe(0);
      expect(summary.hasOverdue).toBe(false);
    });

    it('correctly clamps due dates on month-end to prevent JavaScript month rollover bugs', () => {
      const contractStartingJan31: RentalContract = {
        ...mockContractB,
        lease_start_date: '2026-01-31'
      };

      const schedule = generateMonthlyPaymentSchedule(contractStartingJan31, []);

      // Month 1: Jan 31
      expect(schedule[0].due_date).toBe('2026-01-31');
      // Month 2: Feb 28 (not March 3!)
      expect(schedule[1].due_date).toBe('2026-02-28');
      // Month 3: March 31
      expect(schedule[2].due_date).toBe('2026-03-31');
      // Month 4: April 30 (not May 1!)
      expect(schedule[3].due_date).toBe('2026-04-30');
    });
  });
});
