import { describe, it, expect } from 'vitest';
import {
  calculatePlanningScore,
  getScoreBadgeStyle,
  parsePlotBaseline,
  buildPlotBaselineNoteTag,
  calculateForemanPlotScore,
  calculateForemanAggregates,
  calculateSiteEngineerAggregates,
  calculateProjectPlannerScore
} from '../plannerScoring';

describe('Cascading Construction Planning KPI System', () => {
  describe('calculatePlanningScore (Ladder Step Reduction)', () => {
    it('returns 100 when there are 0 delay revisions', () => {
      expect(calculatePlanningScore(0)).toBe(100);
    });

    it('returns 75 for 1st delay extension (-25)', () => {
      expect(calculatePlanningScore(1)).toBe(75);
    });

    it('returns 50 for 2nd delay extension (-25)', () => {
      expect(calculatePlanningScore(2)).toBe(50);
    });

    it('returns 25 for 3rd delay extension (-25)', () => {
      expect(calculatePlanningScore(3)).toBe(25);
    });

    it('returns 0 for 4th delay extension (-25)', () => {
      expect(calculatePlanningScore(4)).toBe(0);
    });

    it('never drops below 0 for 5+ delay extensions', () => {
      expect(calculatePlanningScore(5)).toBe(0);
      expect(calculatePlanningScore(10)).toBe(0);
    });
  });

  describe('getScoreBadgeStyle', () => {
    it('returns emerald style for 100 or >= 90', () => {
      const style = getScoreBadgeStyle(100);
      expect(style.grade).toBe('ดีเยี่ยม');
      expect(style.bg).toContain('emerald');
    });

    it('returns blue style for 75', () => {
      const style = getScoreBadgeStyle(75);
      expect(style.grade).toBe('ดี');
      expect(style.bg).toContain('blue');
    });

    it('returns amber style for 50', () => {
      const style = getScoreBadgeStyle(50);
      expect(style.grade).toBe('พอใช้');
      expect(style.bg).toContain('amber');
    });

    it('returns orange style for 25', () => {
      const style = getScoreBadgeStyle(25);
      expect(style.grade).toBe('ต้องปรับปรุง');
      expect(style.bg).toContain('orange');
    });

    it('returns rose style for 0', () => {
      const style = getScoreBadgeStyle(0);
      expect(style.grade).toBe('ล่าช้าวิกฤต');
      expect(style.bg).toContain('rose');
    });
  });

  describe('parsePlotBaseline', () => {
    it('returns default unlocked 100 if plot is null', () => {
      const result = parsePlotBaseline(null);
      expect(result.isLocked).toBe(false);
      expect(result.score).toBe(100);
      expect(result.revisions).toBe(0);
    });

    it('reads native columns and assignment data', () => {
      const plot = {
        id: 'plot-1',
        foreman_name: 'ช่างน้อย',
        site_engineer: 'SE ก้อง',
        foreman_assigned_at: '2026-05-01T00:00:00Z',
        baseline_planned_start: '2026-05-01',
        baseline_planned_end: '2026-12-15',
        baseline_locked_at: '2026-05-01T08:00:00Z',
        baseline_locked_by: 'Planner Somchai',
        schedule_delay_revisions: 1,
        schedule_planning_score: 75
      };

      const result = parsePlotBaseline(plot);
      expect(result.isLocked).toBe(true);
      expect(result.foremanName).toBe('ช่างน้อย');
      expect(result.siteEngineer).toBe('SE ก้อง');
      expect(result.score).toBe(75);
      expect(result.revisions).toBe(1);
    });
  });

  describe('Rule 5 (Foreman Handover): calculateForemanPlotScore', () => {
    it('returns 100 for newly assigned foreman even if plot had previous delays', () => {
      const plot = {
        id: 'plot-10',
        foreman_name: 'ช่างเอก (คนใหม่)',
        foreman_assigned_at: '2026-11-01T00:00:00Z',
        baseline_locked_at: '2026-05-01T00:00:00Z',
        baseline_planned_end: '2026-12-30',
        schedule_delay_revisions: 2,
        schedule_planning_score: 50
      };

      // Past revisions under previous foreman occurred before Nov 1
      const pastRevisions = [
        { id: 'rev-1', plot_id: 'plot-10', is_exempted: false, created_at: '2026-06-15T00:00:00Z' },
        { id: 'rev-2', plot_id: 'plot-10', is_exempted: false, created_at: '2026-08-20T00:00:00Z' }
      ];

      // New foreman should start at 100!
      const score = calculateForemanPlotScore(plot, pastRevisions);
      expect(score).toBe(100);
    });

    it('penalizes new foreman only for delays occurring after assignment date', () => {
      const plot = {
        id: 'plot-10',
        foreman_name: 'ช่างเอก (คนใหม่)',
        foreman_assigned_at: '2026-11-01T00:00:00Z',
        baseline_locked_at: '2026-05-01T00:00:00Z',
        baseline_planned_end: '2026-12-30'
      };

      const revisions = [
        { id: 'rev-1', plot_id: 'plot-10', is_exempted: false, created_at: '2026-06-15T00:00:00Z' },
        { id: 'rev-2', plot_id: 'plot-10', is_exempted: false, created_at: '2026-11-10T00:00:00Z' } // 1 new delay
      ];

      const score = calculateForemanPlotScore(plot, revisions);
      expect(score).toBe(75);
    });
  });

  describe('Rule 6 (Force Majeure): Exempted revisions do not deduct score', () => {
    it('ignores exempted revisions in calculateForemanPlotScore', () => {
      const plot = {
        id: 'plot-12',
        foreman_name: 'ช่างน้อย',
        foreman_assigned_at: '2026-01-01T00:00:00Z',
        baseline_locked_at: '2026-01-01T00:00:00Z'
      };

      const revisions = [
        { id: 'rev-1', plot_id: 'plot-12', is_exempted: false, created_at: '2026-03-01T00:00:00Z' }, // -25 (score 75)
        { id: 'rev-2', plot_id: 'plot-12', is_exempted: true, created_at: '2026-05-01T00:00:00Z' }  // force majeure (exempt)
      ];

      // Score stays at 75, does not decrease to 50
      const score = calculateForemanPlotScore(plot, revisions);
      expect(score).toBe(75);
    });
  });

  describe('Rule 2: calculateSiteEngineerAggregates (Weighted Average)', () => {
    it('calculates weighted average score across all plots under the Site Engineer', () => {
      const plots = [
        // Foreman A has 2 plots: 100, 100
        { id: 'p1', site_engineer: 'SE ก้อง', foreman_name: 'ช่าง A', baseline_locked_at: '2026-01-01', schedule_planning_score: 100 },
        { id: 'p2', site_engineer: 'SE ก้อง', foreman_name: 'ช่าง A', baseline_locked_at: '2026-01-01', schedule_planning_score: 100 },
        // Foreman B has 1 plot: 50
        { id: 'p3', site_engineer: 'SE ก้อง', foreman_name: 'ช่าง B', baseline_locked_at: '2026-01-01', schedule_planning_score: 50 }
      ];

      const result = calculateSiteEngineerAggregates(plots);
      expect(result.length).toBe(1);
      const se = result[0];
      expect(se.name).toBe('SE ก้อง');
      expect(se.totalPlots).toBe(3);
      expect(se.foremen).toContain('ช่าง A');
      expect(se.foremen).toContain('ช่าง B');
      // Weighted average: (100 + 100 + 50) / 3 = 250 / 3 = 83.3
      expect(se.weightedAvgScore).toBe(83.3);
      expect(se.grade).toBe('ดี');
    });
  });

  describe('Rule 7: calculateProjectPlannerScore (Hybrid 30% + 70%)', () => {
    it('combines 30% baseline lock rate + 70% site execution score', () => {
      const plots = [
        // 4 plots total, 2 locked (lock rate = 50%)
        { id: 'p1', baseline_locked_at: '2026-01-01', schedule_planning_score: 100 },
        { id: 'p2', baseline_locked_at: '2026-01-01', schedule_planning_score: 100 },
        { id: 'p3', baseline_locked_at: null, schedule_planning_score: 100 },
        { id: 'p4', baseline_locked_at: null, schedule_planning_score: 100 }
      ];

      // Lock rate = 2/4 = 50% -> Baseline Setup Score = 50
      // Execution Score (locked plots avg) = (100 + 100) / 2 = 100
      // Expected Planner Score = round(50 * 0.3 + 100 * 0.7) = round(15 + 70) = 85
      const result = calculateProjectPlannerScore(plots);
      expect(result.totalPlots).toBe(4);
      expect(result.lockedPlots).toBe(2);
      expect(result.lockPercentage).toBe(50);
      expect(result.baselineSetupScore).toBe(50);
      expect(result.siteExecutionScore).toBe(100);
      expect(result.overallScore).toBe(85);
      expect(result.grade).toBe('ดี');
    });

    it('gives 100 when all plots are locked and no delays occur', () => {
      const plots = [
        { id: 'p1', baseline_locked_at: '2026-01-01', schedule_planning_score: 100 },
        { id: 'p2', baseline_locked_at: '2026-01-01', schedule_planning_score: 100 }
      ];

      const result = calculateProjectPlannerScore(plots);
      expect(result.overallScore).toBe(100);
      expect(result.grade).toBe('ดีเยี่ยม');
    });
  });

  describe('assignPlotSiteEngineer & Tag Merging', () => {
    it('preserves isLocked=false and retains siteEngineer when assigning SE to an unlocked plot', () => {
      const plot = {
        id: 'โยริว-1',
        handover_notes: null,
        site_engineer: null
      };

      const tag = buildPlotBaselineNoteTag(plot.handover_notes, {
        siteEngineer: 'วิศวกร กิตติ'
      });

      const updatedPlot = {
        ...plot,
        handover_notes: tag
      };

      const parsed = parsePlotBaseline(updatedPlot);
      expect(parsed.isLocked).toBe(false);
      expect(parsed.siteEngineer).toBe('วิศวกร กิตติ');
      expect(parsed.score).toBe(100);
    });

    it('merges siteEngineer into existing locked baseline without wiping baseline dates', () => {
      const plot = {
        id: 'โยริว-2',
        handover_notes: '[planner_baseline:{"start":"2026-01-01","end":"2026-06-01","lockedAt":"2026-01-01T00:00:00.000Z","revisions":1,"score":75,"foremanName":"DEN"}]'
      };

      const tag = buildPlotBaselineNoteTag(plot.handover_notes, {
        siteEngineer: 'วิศวกร สมศักดิ์'
      });

      const updatedPlot = {
        ...plot,
        handover_notes: tag
      };

      const parsed = parsePlotBaseline(updatedPlot);
      expect(parsed.isLocked).toBe(true);
      expect(parsed.start).toBe('2026-01-01');
      expect(parsed.end).toBe('2026-06-01');
      expect(parsed.revisions).toBe(1);
      expect(parsed.score).toBe(75);
      expect(parsed.foremanName).toBe('DEN');
      expect(parsed.siteEngineer).toBe('วิศวกร สมศักดิ์');
    });
  });
});
