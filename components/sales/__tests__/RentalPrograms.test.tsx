import { describe, it, expect } from 'vitest';
import { calculateRentalTerms, calculateConversionCredit, parseRentalInceptionDetails } from '@/lib/rentalHelper';
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

    it('calculates 8% interest for Program C when entering year 4 with default rent', () => {
      const result = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 15000,
        basePrice: 3000000,
        durationMonths: 48,
        startDate: '2026-01-01'
      });

      // 8% of 15,000 = 1,200
      expect(result.year4InterestPct).toBe(8);
      expect(result.year4BaseRent).toBe(15000);
      expect(result.year4InterestAmount).toBe(1200);
      expect(result.year4MonthlyRent).toBe(16200); // 15,000 + 1,200
    });

    it('calculates 8% interest based on custom agreed installment for Year 4', () => {
      const result = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 15000,
        customYear4MonthlyRent: 20000, // ตกลงผ่อนเพิ่มเป็น 20,000 บาท/เดือน
        basePrice: 3000000,
        durationMonths: 48,
        startDate: '2026-01-01'
      });

      // 8% of 20,000 = 1,600
      expect(result.year4InterestPct).toBe(8);
      expect(result.year4BaseRent).toBe(20000);
      expect(result.year4InterestAmount).toBe(1600);
      expect(result.year4MonthlyRent).toBe(21600); // 20,000 + 1,600
    });

    it('calculates 8% interest with financial 2-decimal precision for decimal rents', () => {
      const result = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 31258.0278,
        basePrice: 3000000,
        durationMonths: 48,
        startDate: '2026-01-01'
      });

      // 31,258.0278 * 8% = 2,500.642224 -> 2,500.64
      expect(result.year4BaseRent).toBe(31258.0278);
      expect(result.year4InterestAmount).toBe(2500.64);
      // 31,258.0278 * 1.08 = 33,758.670024 -> 33,758.67
      expect(result.year4MonthlyRent).toBe(33758.67);
    });
  });

  describe('Advance Rent Options & Program C Contract Fee', () => {
    it('supports disabling advance rent across all programs', () => {
      const resultA = calculateRentalTerms({
        programType: 'program_a',
        monthlyRent: 15000,
        hasAdvanceRent: false
      });
      expect(resultA.hasAdvanceRent).toBe(false);
      expect(resultA.advanceRent).toBe(0);
      expect(resultA.securityDeposit).toBe(30000);
      expect(resultA.totalInitialPayment).toBe(30000); // only deposit

      const resultB = calculateRentalTerms({
        programType: 'program_b',
        monthlyRent: 20000,
        hasAdvanceRent: false
      });
      expect(resultB.advanceRent).toBe(0);
      expect(resultB.totalInitialPayment).toBe(40000);

      const resultC = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 12000,
        hasAdvanceRent: false,
        contractFee: 10000
      });
      expect(resultC.advanceRent).toBe(0);
      expect(resultC.contractFee).toBe(10000);
      expect(resultC.totalInitialPayment).toBe(34000); // deposit 24,000 + fee 10,000
    });

    it('supports multi-month advance rent (e.g. 2 or 3 months)', () => {
      const result = calculateRentalTerms({
        programType: 'program_a',
        monthlyRent: 15000,
        hasAdvanceRent: true,
        advanceRentMonths: 3
      });
      expect(result.advanceRentMonths).toBe(3);
      expect(result.advanceRent).toBe(45000); // 15,000 * 3
      expect(result.securityDeposit).toBe(30000); // 15,000 * 2
      expect(result.totalInitialPayment).toBe(75000); // 45,000 + 30,000
    });

    it('includes contract fee specifically for Program C in total initial payment', () => {
      const resultC = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 15000,
        basePrice: 3000000,
        hasAdvanceRent: true,
        advanceRentMonths: 1,
        contractFee: 10000
      });

      expect(resultC.contractFee).toBe(10000);
      expect(resultC.securityDeposit).toBe(30000);
      expect(resultC.advanceRent).toBe(15000);
      // Total: deposit (30,000) + advance rent (15,000) + contract fee (10,000) = 55,000
      expect(resultC.totalInitialPayment).toBe(55000);

      // Contract fee should not apply to Program A or B
      const resultA = calculateRentalTerms({
        programType: 'program_a',
        monthlyRent: 15000,
        contractFee: 10000
      });
      expect(resultA.contractFee).toBe(0);
      expect(resultA.totalInitialPayment).toBe(45000);
    });

    it('supports configuring security deposit months (e.g. 1 month, 3 months, or 0 months)', () => {
      const result1M = calculateRentalTerms({
        programType: 'program_a',
        monthlyRent: 15000,
        depositMonths: 1
      });
      expect(result1M.depositMonths).toBe(1);
      expect(result1M.securityDeposit).toBe(15000); // 15,000 * 1

      const result3M = calculateRentalTerms({
        programType: 'program_b',
        monthlyRent: 20000,
        depositMonths: 3
      });
      expect(result3M.depositMonths).toBe(3);
      expect(result3M.securityDeposit).toBe(60000); // 20,000 * 3

      const result0M = calculateRentalTerms({
        programType: 'program_c',
        monthlyRent: 12000,
        depositMonths: 0
      });
      expect(result0M.depositMonths).toBe(0);
      expect(result0M.securityDeposit).toBe(0);
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

  describe('Rental Inception Details Parser (7-point Financials)', () => {
    it('accurately parses Plot 26 legacy contract notes with 240,200 THB contract fee', () => {
      const plot26Contract = {
        id: '89f660fb-78cb-4488-af23-32542a0734e6',
        plot_name: '26',
        project_name: 'ไอลิน 4',
        tenant_name: 'คุณวิ',
        program_type: 'program_c',
        monthly_rent: 25000,
        notes: '[เงินจอง: 5,000 บ.] [วันที่จอง: 2026-06-27] [วันที่ทำสัญญา: 2026-07-01] [ราคาบ้านตกลง: 4,699,000 บ.] [เงินประกัน 1 เดือน: 25,000 บ.] [ค่าทำสัญญา: 240,200 บ.] [ไม่เก็บค่าเช่าล่วงหน้า] [ปีที่ 4+: ค่างวดตกลง 31,258.0278 บ. + ดอกเบี้ย 8% รวม 33,758.67 บ./ด.]'
      };

      const details = parseRentalInceptionDetails(plot26Contract);

      expect(details.plotName).toBe('26');
      expect(details.projectName).toBe('ไอลิน 4');
      expect(details.tenantName).toBe('คุณวิ');
      expect(details.bookingDate).toBe('2026-06-27');
      expect(details.bookingAmount).toBe(5000);
      expect(details.contractDate).toBe('2026-07-01');
      expect(details.contractFee).toBe(240200); // User requested 240,200 THB!
      expect(details.securityDeposit).toBe(25000);
      expect(details.advanceRent).toBe(0); // [ไม่เก็บค่าเช่าล่วงหน้า]
    });

    it('falls back to program_c default of 20,000 THB when no custom fee is in notes or column', () => {
      const standardProgramC = {
        plot_name: '12',
        program_type: 'program_c',
        monthly_rent: 20000,
        notes: ''
      };

      const details = parseRentalInceptionDetails(standardProgramC);
      expect(details.contractFee).toBe(20000);
    });

    it('handles structured lead booking records properly', () => {
      const bookedLead = {
        customer_name: 'คุณณัฐพงษ์',
        interested_plot_name: '15',
        project_name: 'ไอลิน สันทราย 2',
        booking_date: '2026-10-15',
        booking_amount: 10000,
        rental_program: 'program_b',
        rental_monthly_rent: 18000,
        rental_deposit: 36000
      };

      const details = parseRentalInceptionDetails(bookedLead);
      expect(details.plotName).toBe('15');
      expect(details.projectName).toBe('ไอลิน สันทราย 2');
      expect(details.bookingDate).toBe('2026-10-15');
      expect(details.bookingAmount).toBe(10000);
      expect(details.securityDeposit).toBe(36000);
    });
  });
});

