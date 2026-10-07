import { supabase } from './supabase';
import { RentalContract, RentalProgramType, RENTAL_PROGRAM_DETAILS, RentalPaymentRecord } from '@/types/sales';

export interface RentalCalculationInput {
  programType: RentalProgramType;
  monthlyRent: number;
  basePrice?: number;
  durationMonths?: number;
  startDate?: string;
  customDeposit?: number;
  customSavingsPerMonth?: number;
}

export interface RentalCalculationResult {
  programType: RentalProgramType;
  monthlyRent: number;
  securityDeposit: number;
  advanceRent: number;
  totalInitialPayment: number;
  savingsPerMonth: number;
  projected1YrSavings: number;
  basePrice: number;
  discount1YrAmount: number;
  netPrice1Yr: number;
  discount2YrAmount: number;
  netPrice2Yr: number;
  endDate: string;
}

/**
 * Safely parses YYYY-MM-DD string to avoid timezone drift across browsers/servers
 */
export function parseDateParts(dateStr: string) {
  if (!dateStr) {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }
  const clean = dateStr.split('T')[0];
  const [y, m, d] = clean.split('-').map(Number);
  return {
    year: y || new Date().getFullYear(),
    month: (m || 1) - 1, // 0-indexed month
    day: d || 1
  };
}

/**
 * Calculates financial breakdown for Rental Programs A, B, and C
 */
export function calculateRentalTerms(input: RentalCalculationInput): RentalCalculationResult {
  const {
    programType,
    monthlyRent = 0,
    basePrice = 0,
    durationMonths = 12,
    startDate = new Date().toISOString().split('T')[0],
    customDeposit,
    customSavingsPerMonth
  } = input;

  // Calculate End Date safely with month clamping
  const { year: startYear, month: startMonth, day: startDay } = parseDateParts(startDate);
  const totalMonthsEnd = startMonth + durationMonths;
  const targetEndYear = startYear + Math.floor(totalMonthsEnd / 12);
  const targetEndMonth = totalMonthsEnd % 12;
  const daysInEndMonth = new Date(targetEndYear, targetEndMonth + 1, 0).getDate();
  const targetEndDay = Math.min(startDay, daysInEndMonth);

  // Inclusive end date (1 day before the next period starts)
  const endDateObj = new Date(targetEndYear, targetEndMonth, targetEndDay);
  endDateObj.setDate(endDateObj.getDate() - 1);
  const endY = endDateObj.getFullYear();
  const endM = String(endDateObj.getMonth() + 1).padStart(2, '0');
  const endD = String(endDateObj.getDate()).padStart(2, '0');
  const endDate = `${endY}-${endM}-${endD}`;

  // Advance rent is 1 month
  const advanceRent = monthlyRent;

  let securityDeposit = 0;
  let savingsPerMonth = 0;

  if (programType === 'program_a') {
    // Program A: Rent - 2 months security deposit
    securityDeposit = customDeposit !== undefined ? customDeposit : monthlyRent * 2;
  } else if (programType === 'program_b') {
    // Program B: Rent to Own - Standard 2 months deposit + 5,000 THB/month savings
    securityDeposit = customDeposit !== undefined ? customDeposit : monthlyRent * 2;
    savingsPerMonth = customSavingsPerMonth !== undefined ? customSavingsPerMonth : 5000;
  } else if (programType === 'program_c') {
    // Program C: Rent and Save - 2 months deposit
    securityDeposit = customDeposit !== undefined ? customDeposit : monthlyRent * 2;
  }

  const totalInitialPayment = advanceRent + securityDeposit;
  const projected1YrSavings = savingsPerMonth * 12;

  // Program C Discounts: 10% within 1 year, 5% within 2 years
  const discount1YrAmount = (basePrice * 10) / 100;
  const netPrice1Yr = Math.max(0, basePrice - discount1YrAmount);

  const discount2YrAmount = (basePrice * 5) / 100;
  const netPrice2Yr = Math.max(0, basePrice - discount2YrAmount);

  return {
    programType,
    monthlyRent,
    securityDeposit,
    advanceRent,
    totalInitialPayment,
    savingsPerMonth,
    projected1YrSavings,
    basePrice,
    discount1YrAmount,
    netPrice1Yr,
    discount2YrAmount,
    netPrice2Yr,
    endDate
  };
}

/**
 * Calculates conversion credit when tenant buys the plot
 */
export function calculateConversionCredit(
  contract: Partial<RentalContract>,
  purchaseDate: string = new Date().toISOString().split('T')[0]
): {
  monthsRented: number;
  accumulatedSavings: number;
  applicableDiscountPct: number;
  applicableDiscountAmount: number;
  basePrice: number;
  finalPurchasePrice: number;
  suggestedBookingCredit: number;
} {
  const startParts = parseDateParts(contract.lease_start_date || new Date().toISOString().split('T')[0]);
  const currentParts = parseDateParts(purchaseDate);
  
  // Calculate elapsed months (minimum 1 month if same month)
  let monthsElapsed = (currentParts.year - startParts.year) * 12 + (currentParts.month - startParts.month);
  if (monthsElapsed <= 0) monthsElapsed = 1;

  const basePrice = Number(contract.base_price || 0);
  let accumulatedSavings = 0;
  let applicableDiscountPct = 0;
  let applicableDiscountAmount = 0;

  if (contract.program_type === 'program_b') {
    // Program B: 5,000 THB/month savings deducted from house price
    const savingsRate = Number(contract.savings_per_month || 5000);
    accumulatedSavings = Number(contract.accumulated_savings !== undefined && contract.accumulated_savings !== null ? contract.accumulated_savings : (savingsRate * monthsElapsed));
  } else if (contract.program_type === 'program_c') {
    // Program C: 10% discount if within 1 year (<= 12 months), 5% if within 2 years (<= 24 months)
    if (monthsElapsed <= 12) {
      applicableDiscountPct = 10;
    } else if (monthsElapsed <= 24) {
      applicableDiscountPct = 5;
    } else {
      applicableDiscountPct = 0;
    }
    applicableDiscountAmount = (basePrice * applicableDiscountPct) / 100;
  }

  // Booking credit can incorporate deposit or savings
  const deposit = Number(contract.security_deposit || 0);
  const suggestedBookingCredit = contract.program_type === 'program_b' 
    ? accumulatedSavings 
    : deposit;

  const finalPurchasePrice = Math.max(0, basePrice - applicableDiscountAmount - accumulatedSavings);

  return {
    monthsRented: monthsElapsed,
    accumulatedSavings,
    applicableDiscountPct,
    applicableDiscountAmount,
    basePrice,
    finalPurchasePrice,
    suggestedBookingCredit
  };
}

/**
 * Generates monthly installment schedule for a rental contract with robust month-end clamping
 */
export function generateMonthlyPaymentSchedule(
  contract: Partial<RentalContract>,
  existingPayments: any[] = []
): Array<RentalPaymentRecord> {
  const duration = Number(contract.lease_duration_months || 12);
  const rent = Number(contract.monthly_rent || 0);
  const savings = contract.program_type === 'program_b' ? Number(contract.savings_per_month || 5000) : 0;
  const startDateStr = contract.lease_start_date || new Date().toISOString().split('T')[0];
  const { year: startYear, month: startMonth, day: startDay } = parseDateParts(startDateStr);
  const todayStr = new Date().toISOString().split('T')[0];

  const monthNamesThai = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  const schedule: Array<RentalPaymentRecord> = [];
  const existingMap = new Map(existingPayments.map(p => [p.period_month, p]));

  for (let i = 1; i <= duration; i++) {
    // Month calculation
    const totalMonths = startMonth + (i - 1);
    const targetYear = startYear + Math.floor(totalMonths / 12);
    const targetMonth = totalMonths % 12;
    
    // Clamp to days in target month (e.g. Feb 28, Apr 30) to avoid JavaScript month rollover
    const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const targetDay = Math.min(startDay, daysInTargetMonth);

    const yyyy = targetYear;
    const mmStr = String(targetMonth + 1).padStart(2, '0');
    const ddStr = String(targetDay).padStart(2, '0');
    const dueDateStr = `${yyyy}-${mmStr}-${ddStr}`;
    const thaiLabel = `งวดที่ ${i} (${monthNamesThai[targetMonth]} ${yyyy + 543})`;

    const existing = existingMap.get(i);

    if (existing) {
      schedule.push({
        ...existing,
        period_month: i,
        period_label: existing.period_label || thaiLabel,
        due_date: existing.due_date || dueDateStr,
        amount_due: Number(existing.amount_due || rent),
        savings_amount: Number(existing.savings_amount !== undefined ? existing.savings_amount : savings),
        amount_paid: Number(existing.amount_paid || 0),
        payment_status: existing.payment_status || (existing.amount_paid >= rent ? 'Paid' : (dueDateStr < todayStr ? 'Overdue' : 'Pending'))
      });
    } else {
      // If no record exists yet, compute default status based on due date vs today
      const isPastDue = dueDateStr < todayStr;
      schedule.push({
        contract_id: contract.id || undefined,
        lead_id: contract.lead_id || undefined,
        plot_id: contract.plot_id || undefined,
        plot_name: contract.plot_name || contract.plot_id || undefined,
        project_name: contract.project_name || undefined,
        tenant_name: contract.tenant_name || undefined,
        period_month: i,
        period_label: thaiLabel,
        due_date: dueDateStr,
        amount_due: rent,
        savings_amount: savings,
        amount_paid: 0,
        paid_date: null,
        payment_status: isPastDue ? 'Overdue' as const : 'Pending' as const
      });
    }
  }

  return schedule;
}

/**
 * Computes payment summary KPI metrics
 */
export function calculateRentalPaymentSummary(
  payments: Array<{
    period_month: number;
    amount_due: number;
    amount_paid: number;
    savings_amount?: number;
    payment_status: string;
    due_date?: string;
  }>
) {
  let paidPeriods = 0;
  let pendingPeriods = 0;
  let overduePeriods = 0;
  let totalAmountDue = 0;
  let totalAmountPaid = 0;
  let totalAccumulatedSavings = 0;

  payments.forEach(p => {
    totalAmountDue += Number(p.amount_due || 0);
    totalAmountPaid += Number(p.amount_paid || 0);
    
    if (p.payment_status === 'Paid') {
      paidPeriods++;
      totalAccumulatedSavings += Number(p.savings_amount || 0);
    } else if (p.payment_status === 'Overdue') {
      overduePeriods++;
    } else {
      pendingPeriods++;
    }
  });

  const totalPeriods = payments.length;
  const totalRemaining = Math.max(0, totalAmountDue - totalAmountPaid);
  const isAllPaid = totalPeriods > 0 && paidPeriods === totalPeriods;
  const hasOverdue = overduePeriods > 0;

  return {
    totalPeriods,
    paidPeriods,
    pendingPeriods,
    overduePeriods,
    totalAmountDue,
    totalAmountPaid,
    totalRemaining,
    totalAccumulatedSavings,
    isAllPaid,
    hasOverdue
  };
}

/**
 * Converts numeric amount to Thai Baht text format (e.g. 15000 -> หนึ่งหมื่นห้าพันบาทถ้วน)
 */
export function formatThaiBahtText(amount: number): string {
  if (isNaN(amount) || amount === 0) return 'ศูนย์บาทถ้วน';
  
  const numbers = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];
  
  const numStr = Math.abs(amount).toFixed(2);
  const [bahtPart, satangPart] = numStr.split('.');
  
  function convertGroup(groupStr: string): string {
    let result = '';
    const len = groupStr.length;
    for (let i = 0; i < len; i++) {
      const digit = Number(groupStr[i]);
      const pos = len - i - 1;
      if (digit !== 0) {
        if (pos === 1 && digit === 1) {
          result += 'สิบ';
        } else if (pos === 1 && digit === 2) {
          result += 'ยี่สิบ';
        } else if (pos === 0 && digit === 1 && len > 1 && groupStr[len - 2] !== '0') {
          result += 'เอ็ด';
        } else {
          result += numbers[digit] + units[pos];
        }
      }
    }
    return result;
  }
  
  let bahtText = '';
  const numBaht = parseInt(bahtPart, 10);
  if (numBaht === 0) {
    bahtText = 'ศูนย์';
  } else if (numBaht >= 1000000) {
    const millionPart = Math.floor(numBaht / 1000000);
    const remPart = numBaht % 1000000;
    bahtText = convertGroup(millionPart.toString()) + 'ล้าน' + (remPart > 0 ? convertGroup(remPart.toString()) : '');
  } else {
    bahtText = convertGroup(bahtPart);
  }
  
  const satangNum = parseInt(satangPart, 10);
  if (satangNum === 0) {
    return (amount < 0 ? 'ลบ' : '') + bahtText + 'บาทถ้วน';
  } else {
    return (amount < 0 ? 'ลบ' : '') + bahtText + 'บาท' + convertGroup(satangPart) + 'สตางค์';
  }
}

/**
 * Generates official receipt / invoice number
 */
export function generateReceiptNumber(type: 'receipt' | 'invoice', periodMonth: number = 1, plotName: string = '01'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = type === 'receipt' ? 'RCP' : 'INV';
  const cleanPlot = plotName.replace(/\D/g, '') || '01';
  return `${prefix}-${yyyy}${mm}-P${cleanPlot.padStart(2, '0')}-M${String(periodMonth).padStart(2, '0')}`;
}

