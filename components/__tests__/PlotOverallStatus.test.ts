import { describe, it, expect } from 'vitest';

describe('Plot Overall Status and Delayed Threshold Rules', () => {
  // Pure function replica of the status calculation used in getPlotOverallStatus and SalesKanban
  function computePlotStatus(actualAvg: number, plannedAvg: number, saleStatus?: string) {
    if (saleStatus === 'ready_for_sale') return { status: 'ready_for_sale', label: 'พร้อมขาย/รอโอน' };
    if (actualAvg === 0 && plannedAvg === 0) return { status: 'none', label: 'รอดำเนินการ' };
    if (actualAvg >= 100 && plannedAvg >= 100) return { status: 'completed', label: 'เสร็จสมบูรณ์' };
    if (actualAvg < plannedAvg) return { status: 'delayed', label: 'ล่าช้ากว่าแผน' };
    if (actualAvg > plannedAvg + 10) return { status: 'ahead', label: 'เร็วกว่าแผน' };
    return { status: 'on-track', label: 'ตามแผน' };
  }

  // Pure function replica of isSummaryDelayed
  function checkIsSummaryDelayed(daysElapsed: number, totalPlannedDays: number, progress: number) {
    return daysElapsed > 0 && totalPlannedDays > 0 && progress < (daysElapsed / totalPlannedDays) * 100;
  }

  describe('Delayed status (Actual < Planned - No 10% buffer)', () => {
    it('marks as delayed even if actual is only 1% below plan', () => {
      const result = computePlotStatus(49, 50);
      expect(result.status).toBe('delayed');
      expect(result.label).toBe('ล่าช้ากว่าแผน');
    });

    it('marks as delayed when actual is significantly below plan', () => {
      const result = computePlotStatus(20, 50);
      expect(result.status).toBe('delayed');
    });
  });

  describe('On-track status (Planned <= Actual <= Planned + 10)', () => {
    it('marks as on-track when actual exactly matches planned', () => {
      const result = computePlotStatus(50, 50);
      expect(result.status).toBe('on-track');
      expect(result.label).toBe('ตามแผน');
    });

    it('marks as on-track when actual is slightly above planned (+1%)', () => {
      const result = computePlotStatus(51, 50);
      expect(result.status).toBe('on-track');
      expect(result.label).toBe('ตามแผน');
    });

    it('marks as on-track when actual is up to 10% above planned (+10%)', () => {
      const result = computePlotStatus(60, 50);
      expect(result.status).toBe('on-track');
      expect(result.label).toBe('ตามแผน');
    });
  });

  describe('Ahead status (Actual > Planned + 10)', () => {
    it('marks as ahead when actual is more than 10% above planned (+11%)', () => {
      const result = computePlotStatus(61, 50);
      expect(result.status).toBe('ahead');
      expect(result.label).toBe('เร็วกว่าแผน');
    });
  });

  describe('Special states', () => {
    it('marks as completed when both actual and planned are >= 100%', () => {
      const result = computePlotStatus(100, 100);
      expect(result.status).toBe('completed');
    });

    it('marks as ready_for_sale regardless of progress when sale_status is ready_for_sale', () => {
      const result = computePlotStatus(85, 90, 'ready_for_sale');
      expect(result.status).toBe('ready_for_sale');
    });

    it('marks as none when both actual and planned are 0%', () => {
      const result = computePlotStatus(0, 0);
      expect(result.status).toBe('none');
    });
  });

  describe('isSummaryDelayed helper', () => {
    it('returns true when actual progress is lower than time-based expected progress', () => {
      // 50 days elapsed of 100 total days = 50% expected
      expect(checkIsSummaryDelayed(50, 100, 49)).toBe(true);
      expect(checkIsSummaryDelayed(50, 100, 40)).toBe(true);
    });

    it('returns false when actual progress is equal to or greater than expected progress', () => {
      expect(checkIsSummaryDelayed(50, 100, 50)).toBe(false);
      expect(checkIsSummaryDelayed(50, 100, 51)).toBe(false);
      expect(checkIsSummaryDelayed(50, 100, 65)).toBe(false);
    });

    it('returns false when daysElapsed is 0 or totalPlannedDays is 0', () => {
      expect(checkIsSummaryDelayed(0, 100, 0)).toBe(false);
      expect(checkIsSummaryDelayed(50, 0, 0)).toBe(false);
    });
  });
});
