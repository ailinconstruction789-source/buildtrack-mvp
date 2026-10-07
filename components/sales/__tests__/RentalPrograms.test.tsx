import { describe, it, expect } from 'vitest';
import { calculateRentalTerms, calculateConversionCredit } from '@/lib/rentalHelper';
import { RENTAL_PROGRAM_DETAILS } from '@/types/sales';

describe('Ailin Rental Programs Helper & Calculations', () => {
  it('has valid metadata for all 3 programs (A, B, C)', () => {
    expect(RENTAL_PROGRAM_DETAILS.program_a.name).toContain('Rent');
    expect(RENTAL_PROGRAM_DETAILS.program_b.name).toContain('Rent to Own');
    expect(RENTAL_PROGRAM_DETAILS.program_c.name).toContain('Rent and Save');

    expect(RENTAL_PROGRAM_DETAILS.program_a.depositMonths).toBe(2);
    expect(RENTAL_PROGRAM_DETAILS.program_b.savingsPerMonthDefault).toBe(5000);
    expect(RENTAL_PROGRAM_DETAILS.program_c.discount1YrPct).toBe(10);
    expect(RENTAL_PROGRAM_DETAILS.program_c.discount2YrPct).toBe(5);
  });

  describe('Program A: Rent (เช่าปกติ)', () => {
    it('calculates 2 months deposit and 1 month advance payment', () => {
      const result = calculateRentalTerms({
        programType: 'program_a',
        monthlyRent: 15000,
        durationMonths: 12,
        startDate: '2026-01-01'
      });

      expect(result.monthlyRent).toBe(15000);
      expect(result.securityDeposit).toBe(30000); // 15,000 * 2
      expect(result.advanceRent).toBe(15000);
      expect(result.totalInitialPayment).toBe(45000);
      expect(result.savingsPerMonth).toBe(0);
      expect(result.endDate).toBe('2026-12-31');
    });
  });

  describe('Program B: Rent to Own (เช่าซื้อ)', () => {
    it('calculates 5,000 THB/month savings and projected 1-year accumulated savings', () => {
      const result = calculateRentalTerms({
        programType: 'program_b',
        monthlyRent: 18000,
        durationMonths: 12,
        startDate: '2026-01-01'
      });

      expect(result.monthlyRent).toBe(18000);
      expect(result.securityDeposit).toBe(36000);
      expect(result.savingsPerMonth).toBe(5000);
      expect(result.projected1YrSavings).toBe(60000); // 5,000 * 12
    });

    it('calculates conversion credit by deducting accumulated savings from house price', () => {
      const contract = {
        program_type: 'program_b' as const,
        base_price: 3000000,
        savings_per_month: 5000,
        lease_start_date: '2026-01-01'
      };

      // After 10 months
      const credit = calculateConversionCredit(contract, '2026-11-01');
      expect(credit.monthsRented).toBe(10);
      expect(credit.accumulatedSavings).toBe(50000); // 5,000 * 10
      expect(credit.finalPurchasePrice).toBe(2950000); // 3,000,000 - 50,000
    });
  });

  describe('Program C: Rent and Save (เช่าออม)', () => {
    it('calculates 10% discount for 1-year and 5% discount for 2-year transfer', () => {
      const result = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 20000,
        basePrice: 3000000,
        durationMonths: 12,
        startDate: '2026-01-01'
      });

      expect(result.basePrice).toBe(3000000);
      expect(result.discount1YrAmount).toBe(300000); // 10% of 3,000,000
      expect(result.netPrice1Yr).toBe(2700000);
      expect(result.discount2YrAmount).toBe(150000); // 5% of 3,000,000
      expect(result.netPrice2Yr).toBe(2850000);
    });

    it('applies 10% discount when purchasing within 1 year', () => {
      const contract = {
        program_type: 'program_c' as const,
        base_price: 3500000,
        lease_start_date: '2026-01-01'
      };

      const credit = calculateConversionCredit(contract, '2026-07-01'); // 6 months
      expect(credit.monthsRented).toBe(6);
      expect(credit.applicableDiscountPct).toBe(10);
      expect(credit.applicableDiscountAmount).toBe(350000);
      expect(credit.finalPurchasePrice).toBe(3150000);
    });

    it('applies 5% discount when purchasing within 2 years', () => {
      const contract = {
        program_type: 'program_c' as const,
        base_price: 3500000,
        lease_start_date: '2026-01-01'
      };

      const credit = calculateConversionCredit(contract, '2027-06-01'); // 17 months
      expect(credit.monthsRented).toBe(17);
      expect(credit.applicableDiscountPct).toBe(5);
      expect(credit.applicableDiscountAmount).toBe(175000);
      expect(credit.finalPurchasePrice).toBe(3325000);
    });
  });

  describe('Lead Integration & Prioritization Rules', () => {
    it('prioritizes leads interested in the target plot over general leads', () => {
      const mockLeads = [
        { id: '1', customer_name: 'คุณกานดา', interested_plot_name: 'A-01', project_name: 'ไอลิน6' },
        { id: '2', customer_name: 'คุณสมศักดิ์', interested_plot_name: 'A-05', project_name: 'ไอลิน6' },
        { id: '3', customer_name: 'คุณมานี', interested_plot_name: 'B-02', project_name: 'ไอลิน6' }
      ];

      const targetPlot = 'A-05';
      const sorted = [...mockLeads].sort((a, b) => {
        const scoreA = a.interested_plot_name === targetPlot ? 100 : 0;
        const scoreB = b.interested_plot_name === targetPlot ? 100 : 0;
        return scoreB - scoreA;
      });

      expect(sorted[0].customer_name).toBe('คุณสมศักดิ์');
      expect(sorted[0].interested_plot_name).toBe('A-05');
    });
  });
});
