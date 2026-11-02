import { describe, it, expect } from 'vitest';
import {
  calculatePlanningScore,
  getScoreBadgeStyle,
  parsePlotBaseline,
  buildPlotBaselineNoteTag
} from '../plannerScoring';

describe('Project Planner Schedule Scoring System', () => {
  describe('calculatePlanningScore (Option 2 - Ladder Step Reduction)', () => {
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
    it('returns emerald style for 100', () => {
      const style = getScoreBadgeStyle(100);
      expect(style.score).toBe(100);
      expect(style.grade).toBe('ดีเยี่ยม');
      expect(style.bg).toContain('emerald');
    });

    it('returns blue style for 75', () => {
      const style = getScoreBadgeStyle(75);
      expect(style.score).toBe(75);
      expect(style.grade).toBe('ดี');
      expect(style.bg).toContain('blue');
    });

    it('returns amber style for 50', () => {
      const style = getScoreBadgeStyle(50);
      expect(style.score).toBe(50);
      expect(style.grade).toBe('พอใช้');
      expect(style.bg).toContain('amber');
    });

    it('returns orange style for 25', () => {
      const style = getScoreBadgeStyle(25);
      expect(style.score).toBe(25);
      expect(style.grade).toBe('ต้องปรับปรุง');
      expect(style.bg).toContain('orange');
    });

    it('returns rose style for 0', () => {
      const style = getScoreBadgeStyle(0);
      expect(style.score).toBe(0);
      expect(style.grade).toBe('ล่าช้าวิกฤต');
      expect(style.bg).toContain('rose');
    });
  });

  describe('parsePlotBaseline', () => {
    it('returns default unlocked 100 if plot is null or has no baseline data', () => {
      const result = parsePlotBaseline(null);
      expect(result.isLocked).toBe(false);
      expect(result.score).toBe(100);
      expect(result.revisions).toBe(0);
    });

    it('reads baseline from native columns when present', () => {
      const plot = {
        id: 'plot-1',
        baseline_planned_start: '2026-01-01',
        baseline_planned_end: '2026-06-30',
        baseline_locked_at: '2026-01-01T08:00:00Z',
        baseline_locked_by: 'Somchai (Planner)',
        schedule_delay_revisions: 1,
        schedule_planning_score: 75
      };

      const result = parsePlotBaseline(plot);
      expect(result.isLocked).toBe(true);
      expect(result.start).toBe('2026-01-01');
      expect(result.end).toBe('2026-06-30');
      expect(result.lockedBy).toBe('Somchai (Planner)');
      expect(result.revisions).toBe(1);
      expect(result.score).toBe(75);
    });

    it('reads baseline from handover_notes tag when native columns are empty', () => {
      const tagData = {
        start: '2026-02-01',
        end: '2026-07-31',
        lockedAt: '2026-02-01T08:00:00Z',
        lockedBy: 'Planner A',
        revisions: 2,
        score: 50
      };
      const plot = {
        id: 'plot-2',
        handover_notes: `Some existing notes [planner_baseline:${JSON.stringify(tagData)}] other text`
      };

      const result = parsePlotBaseline(plot);
      expect(result.isLocked).toBe(true);
      expect(result.start).toBe('2026-02-01');
      expect(result.end).toBe('2026-07-31');
      expect(result.lockedBy).toBe('Planner A');
      expect(result.revisions).toBe(2);
      expect(result.score).toBe(50);
    });
  });

  describe('buildPlotBaselineNoteTag', () => {
    it('appends tag to existing notes without destroying them', () => {
      const oldNotes = 'Customer requested special tiles [sandwash_coating:done]';
      const data = {
        start: '2026-01-01',
        end: '2026-06-30',
        lockedAt: '2026-01-01T08:00:00Z',
        lockedBy: 'Planner',
        revisions: 0,
        score: 100
      };
      const updated = buildPlotBaselineNoteTag(oldNotes, data);
      expect(updated).toContain('Customer requested special tiles [sandwash_coating:done]');
      expect(updated).toContain('[planner_baseline:');
      expect(updated).toContain('"score":100');
    });

    it('replaces existing planner_baseline tag instead of duplicating', () => {
      const oldNotes = 'Notes [planner_baseline:{"start":"2026-01-01","end":"2026-05-01","revisions":0,"score":100}]';
      const data = {
        start: '2026-01-01',
        end: '2026-06-01',
        lockedAt: '2026-01-01T08:00:00Z',
        lockedBy: 'Planner',
        revisions: 1,
        score: 75
      };
      const updated = buildPlotBaselineNoteTag(oldNotes, data);
      expect(updated.match(/\[planner_baseline:/g)?.length).toBe(1);
      expect(updated).toContain('"score":75');
      expect(updated).toContain('"revisions":1');
    });
  });

  describe('isRelevantExecutiveProject', () => {
    it('includes ไอลิน6 and ไอลิน 6', async () => {
      const { isRelevantExecutiveProject } = await import('../constructionReportsIndex');
      expect(isRelevantExecutiveProject('ไอลิน6')).toBe(true);
      expect(isRelevantExecutiveProject('ไอลิน 6')).toBe(true);
    });

    it('excludes legacy projects: ไอลิน 2, 3, 4, โยริว, กานต์รวี', async () => {
      const { isRelevantExecutiveProject } = await import('../constructionReportsIndex');
      expect(isRelevantExecutiveProject('ไอลิน 2')).toBe(false);
      expect(isRelevantExecutiveProject('ไอลิน 3')).toBe(false);
      expect(isRelevantExecutiveProject('ไอลิน 4')).toBe(false);
      expect(isRelevantExecutiveProject('โยริว')).toBe(false);
      expect(isRelevantExecutiveProject('กานต์รวี4')).toBe(false);
      expect(isRelevantExecutiveProject('กานต์รวี2')).toBe(false);
      expect(isRelevantExecutiveProject('ลูกค้าทั่วไป')).toBe(false);
    });

    it('includes newly created future projects', async () => {
      const { isRelevantExecutiveProject } = await import('../constructionReportsIndex');
      expect(isRelevantExecutiveProject('ไอลิน 7')).toBe(true);
      expect(isRelevantExecutiveProject('ไอลิน 8')).toBe(true);
      expect(isRelevantExecutiveProject('เดอะพาร์ค วิลล่า')).toBe(true);
    });
  });
});
