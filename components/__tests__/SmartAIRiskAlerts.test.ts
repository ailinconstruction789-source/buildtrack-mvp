import { describe, it, expect } from 'vitest';

describe('Smart AI Risk Alerts - Filtering & Predictive Forecasting', () => {
  // Pure replica of the filtering rule in OwnerAnalyticsDashboard
  const isPlotCompletedOrReadyForSale = (p: any) => {
    if (!p) return true;
    const isCompleted = Boolean(p.is_completed) || Number(p.progress) >= 100 || p.handover_status === 'completed';
    const isReadyForSale = p.sale_status === 'ready_for_sale';
    return isCompleted || isReadyForSale;
  };

  // Pure replica of Thai Buddhist Era date formatter
  const formatThaiDate = (val: any) => {
    if (!val) return 'ไม่ระบุ';
    const d = new Date(val);
    if (isNaN(d.getTime())) return 'ไม่ระบุ';
    const thaiYear = d.getFullYear() + 543;
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d.getDate()} ${months[d.getMonth()]} ${thaiYear}`;
  };

  // Pure replica of the predictive delay algorithm
  function computePredictiveDelay(params: {
    overallProgress: number;
    minPlannedStart: number;
    maxPlannedEnd: number;
    firstActualStart: number;
    nowTime: number;
    contractorDelayProb?: number;
    contractorReworks?: number;
    lastActualUpdate?: number;
  }) {
    const {
      overallProgress,
      minPlannedStart,
      maxPlannedEnd,
      firstActualStart,
      nowTime,
      contractorDelayProb = 0,
      contractorReworks = 0,
      lastActualUpdate = 0
    } = params;

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const totalPlannedDays = Math.max(14, Math.round((maxPlannedEnd - minPlannedStart) / MS_PER_DAY));
    const plannedVelocity = 100 / totalPlannedDays;

    let penaltyDays = 0;
    if (contractorDelayProb > 50) {
      penaltyDays += Math.max(3, Math.round(contractorDelayProb / 10));
    }
    if (contractorReworks >= 3) {
      penaltyDays += Math.min(5, contractorReworks);
    }
    if (lastActualUpdate > 0 && (nowTime - lastActualUpdate > 10 * MS_PER_DAY) && overallProgress < 90) {
      penaltyDays += Math.min(10, Math.floor((nowTime - lastActualUpdate) / MS_PER_DAY));
    }

    if (overallProgress === 0) {
      if (minPlannedStart > 0 && nowTime > minPlannedStart + (5 * MS_PER_DAY)) {
        const startDelay = Math.floor((nowTime - minPlannedStart) / MS_PER_DAY);
        const expectedEnd = maxPlannedEnd + ((startDelay + penaltyDays) * MS_PER_DAY);
        const delayDays = Math.ceil((expectedEnd - maxPlannedEnd) / MS_PER_DAY);
        return { delayDays, isAlert: delayDays >= 5 };
      }
      return { delayDays: 0, isAlert: false };
    }

    const effectiveStart = firstActualStart > 0 ? firstActualStart : minPlannedStart;
    const daysSinceStart = Math.max(7, (nowTime - effectiveStart) / MS_PER_DAY);
    const actualVelocityPerDay = overallProgress / daysSinceStart;
    const blendedVelocity = Math.max(0.15, (actualVelocityPerDay * 0.7) + (plannedVelocity * 0.3));
    const remainingProgress = 100 - overallProgress;
    const daysToFinish = remainingProgress / blendedVelocity;

    const expectedEnd = nowTime + Math.round((daysToFinish + penaltyDays) * MS_PER_DAY);
    const delayDays = Math.ceil((expectedEnd - maxPlannedEnd) / MS_PER_DAY);

    return {
      delayDays,
      blendedVelocity,
      expectedEnd,
      isAlert: delayDays >= 5
    };
  }

  describe('Exclusion of Finished and Ready-for-Sale Houses', () => {
    it('excludes house when is_completed is true', () => {
      expect(isPlotCompletedOrReadyForSale({ is_completed: true, progress: 100 })).toBe(true);
      expect(isPlotCompletedOrReadyForSale({ is_completed: true, progress: 95 })).toBe(true);
    });

    it('excludes house when progress is >= 100%', () => {
      expect(isPlotCompletedOrReadyForSale({ is_completed: false, progress: 100 })).toBe(true);
      expect(isPlotCompletedOrReadyForSale({ is_completed: false, progress: 105 })).toBe(true);
    });

    it('excludes house when handover_status is completed', () => {
      expect(isPlotCompletedOrReadyForSale({ handover_status: 'completed', progress: 95 })).toBe(true);
    });

    it('excludes house when sale_status is ready_for_sale', () => {
      expect(isPlotCompletedOrReadyForSale({ sale_status: 'ready_for_sale', progress: 85 })).toBe(true);
      expect(isPlotCompletedOrReadyForSale({ sale_status: 'ready_for_sale', progress: 90, is_completed: false })).toBe(true);
    });

    it('includes houses that are actively under construction', () => {
      expect(isPlotCompletedOrReadyForSale({ is_completed: false, progress: 40, sale_status: 'normal' })).toBe(false);
      expect(isPlotCompletedOrReadyForSale({ is_completed: false, progress: 0, sale_status: 'active' })).toBe(false);
      expect(isPlotCompletedOrReadyForSale({ is_completed: false, progress: 75, handover_status: 'in_progress' })).toBe(false);
    });
  });

  describe('Thai Buddhist Era Date Formatting', () => {
    it('correctly converts CE year to BE year (+543)', () => {
      const formatted = formatThaiDate('2026-11-25T00:00:00Z');
      expect(formatted).toContain('2569');
      expect(formatted).toContain('25 พ.ย. 2569');
    });

    it('handles null or invalid date gracefully', () => {
      expect(formatThaiDate(null)).toBe('ไม่ระบุ');
      expect(formatThaiDate(undefined)).toBe('ไม่ระบุ');
      expect(formatThaiDate('invalid-date')).toBe('ไม่ระบุ');
    });
  });

  describe('Predictive Forecasting Calculations', () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const nowTime = new Date('2026-09-20T12:00:00Z').getTime();

    it('flags unstarted plot that missed planned start date by more than 5 days', () => {
      const minPlannedStart = nowTime - (10 * MS_PER_DAY); // planned start 10 days ago
      const maxPlannedEnd = nowTime + (80 * MS_PER_DAY);

      const result = computePredictiveDelay({
        overallProgress: 0,
        minPlannedStart,
        maxPlannedEnd,
        firstActualStart: 0,
        nowTime
      });

      expect(result.isAlert).toBe(true);
      expect(result.delayDays).toBeGreaterThanOrEqual(10);
    });

    it('predicts delay when actual velocity is too low to meet deadline', () => {
      const minPlannedStart = nowTime - (30 * MS_PER_DAY); // started 30 days ago
      const maxPlannedEnd = nowTime + (30 * MS_PER_DAY); // 30 days remaining
      // In 30 days out of 60, progress is only 15% (needs 85% more in 30 days)
      const result = computePredictiveDelay({
        overallProgress: 15,
        minPlannedStart,
        maxPlannedEnd,
        firstActualStart: minPlannedStart,
        nowTime
      });

      expect(result.isAlert).toBe(true);
      expect(result.delayDays).toBeGreaterThan(5);
    });

    it('does not trigger alert when construction is progressing on-track', () => {
      const minPlannedStart = nowTime - (45 * MS_PER_DAY);
      const maxPlannedEnd = nowTime + (45 * MS_PER_DAY); // 90 days total
      // Progress is 60% with 45 days remaining (needs 40% in 45 days => on track)
      const result = computePredictiveDelay({
        overallProgress: 60,
        minPlannedStart,
        maxPlannedEnd,
        firstActualStart: minPlannedStart,
        nowTime
      });

      expect(result.isAlert).toBe(false);
      expect(result.delayDays).toBeLessThan(5);
    });

    it('incorporates contractor delay penalty and reworks penalty', () => {
      const minPlannedStart = nowTime - (30 * MS_PER_DAY);
      const maxPlannedEnd = nowTime + (30 * MS_PER_DAY);

      const baselineResult = computePredictiveDelay({
        overallProgress: 35,
        minPlannedStart,
        maxPlannedEnd,
        firstActualStart: minPlannedStart,
        nowTime
      });

      const penalisedResult = computePredictiveDelay({
        overallProgress: 35,
        minPlannedStart,
        maxPlannedEnd,
        firstActualStart: minPlannedStart,
        nowTime,
        contractorDelayProb: 80, // penalty ~8 days
        contractorReworks: 4    // penalty ~4 days
      });

      expect(penalisedResult.delayDays).toBeGreaterThan(baselineResult.delayDays);
    });
  });

  describe('Plot Sorting Options (Default: plot_asc)', () => {
    const mockPlots = [
      { plotName: '10', delayDays: 12, overallProgress: 40, severity: 'medium' },
      { plotName: '02', delayDays: 25, overallProgress: 20, severity: 'high' },
      { plotName: '01', delayDays: 8, overallProgress: 60, severity: 'medium' },
      { plotName: 'A-05', delayDays: 18, overallProgress: 15, severity: 'high' }
    ];

    function sortPlots(list: any[], sortBy: string) {
      const copy = [...list];
      if (sortBy === 'plot_asc') {
        return copy.sort((a, b) => (a.plotName || '').localeCompare(b.plotName || '', undefined, { numeric: true, sensitivity: 'base' }));
      }
      if (sortBy === 'delay_desc') {
        return copy.sort((a, b) => b.delayDays - a.delayDays);
      }
      if (sortBy === 'progress_asc') {
        return copy.sort((a, b) => a.overallProgress - b.overallProgress);
      }
      if (sortBy === 'risk_severity') {
        return copy.sort((a, b) => {
          const aSev = a.severity === 'high' ? 2 : 1;
          const bSev = b.severity === 'high' ? 2 : 1;
          if (bSev !== aSev) return bSev - aSev;
          return b.delayDays - a.delayDays;
        });
      }
      return copy;
    }

    it('correctly sorts by plot_asc as default (natural alphanumeric: 01, 02, 10, A-05)', () => {
      const sorted = sortPlots(mockPlots, 'plot_asc');
      expect(sorted.map(p => p.plotName)).toEqual(['01', '02', '10', 'A-05']);
    });

    it('correctly sorts by delay_desc (highest delay days first)', () => {
      const sorted = sortPlots(mockPlots, 'delay_desc');
      expect(sorted.map(p => p.delayDays)).toEqual([25, 18, 12, 8]);
      expect(sorted[0].plotName).toBe('02');
    });

    it('correctly sorts by progress_asc (lowest progress percentage first)', () => {
      const sorted = sortPlots(mockPlots, 'progress_asc');
      expect(sorted.map(p => p.overallProgress)).toEqual([15, 20, 40, 60]);
      expect(sorted[0].plotName).toBe('A-05');
    });

    it('correctly sorts by risk_severity (high severity plots before medium)', () => {
      const sorted = sortPlots(mockPlots, 'risk_severity');
      expect(sorted[0].severity).toBe('high');
      expect(sorted[1].severity).toBe('high');
      expect(sorted[2].severity).toBe('medium');
      expect(sorted[3].severity).toBe('medium');
      expect(sorted[0].delayDays).toBe(25);
      expect(sorted[1].delayDays).toBe(18);
    });
  });
});

