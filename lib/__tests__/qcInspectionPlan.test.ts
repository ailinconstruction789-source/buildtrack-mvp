import { describe, it, expect } from 'vitest';
import {
  calculateQCWorkloadWeight,
  isSubmissionAfterCutoff,
  getNextDateStr,
  buildQCDailyInspectionPlan,
} from '../qcInspectionPlan';

describe('QC Inspection Plan Library (lib/qcInspectionPlan.ts)', () => {
  describe('Task Weighting and Categorization', () => {
    it('classifies concrete/structural work as 5-point Hold Point', () => {
      const tasks = [
        'งานเทคอนกรีตเสาชั้น 1',
        'งานเทคานคอดิน',
        'งานฐานรากและเสาเข็ม',
      ];
      tasks.forEach(t => {
        const meta = calculateQCWorkloadWeight(t);
        expect(meta.weight_score).toBe(5);
        expect(meta.is_hold_point).toBe(true);
        expect(meta.category).toBe('hold_point');
      });
    });

    it('classifies roof and general structural work as 4-point Hold Point', () => {
      const meta = calculateQCWorkloadWeight('งานโครงหลังคาเหล็ก');
      expect(meta.weight_score).toBe(4);
      expect(meta.is_hold_point).toBe(true);
      expect(meta.category).toBe('hold_point');
    });

    it('classifies MEP and concealed piping as 3-point System work', () => {
      const tasks = [
        'งานเดินท่อร้อยสายไฟ',
        'งานระบบสุขาภิบาลและประปา',
        'งานทากันซึมห้องน้ำ',
      ];
      tasks.forEach(t => {
        const meta = calculateQCWorkloadWeight(t);
        expect(meta.weight_score).toBe(3);
        expect(meta.is_hold_point).toBe(false);
        expect(meta.category).toBe('system');
      });
    });

    it('classifies architectural and finishing work as 2-point work', () => {
      const tasks = [
        'งานก่ออิฐมวลเบา',
        'งานฉาบปูนภายใน',
        'งานปูกระเบื้องห้องน้ำ',
        'งานติดตั้งประตูและหน้าต่างอลูมิเนียม',
      ];
      tasks.forEach(t => {
        const meta = calculateQCWorkloadWeight(t);
        expect(meta.weight_score).toBe(2);
        expect(meta.is_hold_point).toBe(false);
        expect(meta.category).toBe('architectural');
      });
    });

    it('classifies minor cleanup and landscaping as 1-point work', () => {
      const tasks = [
        'งานทำความสะอาด ครั้งที่ 1',
        'งานเก็บกวาดเศษวัสดุ',
        'งานปูหญ้าและจัดสวน',
      ];
      tasks.forEach(t => {
        const meta = calculateQCWorkloadWeight(t);
        expect(meta.weight_score).toBe(1);
        expect(meta.is_hold_point).toBe(false);
        expect(meta.category).toBe('minor');
      });
    });
  });

  describe('Cut-Off Time and Date Scheduling', () => {
    it('detects submission before 17:00 as within same-day window', () => {
      // 2026-11-21T07:30:00Z = 14:30 Bangkok time (GMT+7)
      expect(isSubmissionAfterCutoff('2026-11-21T07:30:00Z', 17)).toBe(false);
    });

    it('detects submission after 17:00 as late handoff', () => {
      // 2026-11-21T10:30:00Z = 17:30 Bangkok time (GMT+7)
      expect(isSubmissionAfterCutoff('2026-11-21T10:30:00Z', 17)).toBe(true);
      // 2026-11-21T12:00:00Z = 19:00 Bangkok time (GMT+7)
      expect(isSubmissionAfterCutoff('2026-11-21T12:00:00Z', 17)).toBe(true);
    });

    it('computes next date correctly', () => {
      expect(getNextDateStr('2026-11-21', 1)).toBe('2026-11-22');
      expect(getNextDateStr('2026-11-21', 2)).toBe('2026-11-23');
    });
  });

  describe('Daily QC Inspection Plan Generation', () => {
    const mockQueue = [
      // 1. Structural Hold Point submitted at 11:00 (5 pts)
      {
        plot_id: 'p1',
        task_template_id: 't1',
        task_name: 'งานเทคอนกรีตเสา',
        project_name: 'ไอลิน 6',
        foreman: 'LEAB',
        statusFor: 'QC',
        created_at: '2026-11-21T04:00:00Z', // 11:00 BKK
      },
      // 2. Architectural task submitted at 14:00 (2 pts)
      {
        plot_id: 'p2',
        task_template_id: 't2',
        task_name: 'งานปูกระเบื้อง',
        project_name: 'ไอลิน 6',
        foreman: 'VIEW',
        statusFor: 'QC',
        created_at: '2026-11-21T07:00:00Z', // 14:00 BKK
      },
      // 3. Minor task submitted late at 17:45 (1 pt) -> late handoff
      {
        plot_id: 'p3',
        task_template_id: 't3',
        task_name: 'งานทำความสะอาด',
        project_name: 'ไอลิน 7',
        foreman: 'SOMCHAI',
        statusFor: 'QC',
        created_at: '2026-11-21T10:45:00Z', // 17:45 BKK
      },
      // 4. Non-QC item (waiting for SE) -> should be excluded
      {
        plot_id: 'p4',
        task_template_id: 't4',
        task_name: 'งานก่ออิฐ',
        project_name: 'ไอลิน 6',
        statusFor: 'Site Engineer',
        created_at: '2026-11-21T05:00:00Z',
      },
      // 5. Demo Project task -> MUST be excluded per Rule
      {
        plot_id: 'demo-1',
        task_template_id: 't5',
        task_name: 'งานเทคาน Demo',
        project_name: 'Admin Demo Project',
        statusFor: 'QC',
        created_at: '2026-11-21T06:00:00Z',
      },
    ];

    it('excludes demo project and non-QC tasks strictly', () => {
      const plan = buildQCDailyInspectionPlan({
        inspectionQueue: mockQueue,
        todayDateStr: '2026-11-21',
      });

      expect(plan.totalTasks).toBe(3);
      expect(plan.tasks.some(t => t.project_name.includes('Demo'))).toBe(false);
      expect(plan.tasks.some(t => t.task_name === 'งานก่ออิฐ')).toBe(false);
    });

    it('calculates total weighted score and aggregates categories correctly', () => {
      const plan = buildQCDailyInspectionPlan({
        inspectionQueue: mockQueue,
        todayDateStr: '2026-11-21',
      });

      // 5 pts (เสา) + 2 pts (กระเบื้อง) + 1 pt (ทำความสะอาด) = 8 pts
      expect(plan.totalPoints).toBe(8);
      expect(plan.holdPointsCount).toBe(1);
      expect(plan.lateHandoffCount).toBe(1);
      expect(plan.byCategory.hold_point.points).toBe(5);
      expect(plan.byCategory.architectural.points).toBe(2);
      expect(plan.byCategory.minor.points).toBe(1);
    });

    it('prioritizes Hold Point items at the top of the plan', () => {
      const plan = buildQCDailyInspectionPlan({
        inspectionQueue: mockQueue,
        todayDateStr: '2026-11-21',
      });

      expect(plan.tasks[0].task_name).toBe('งานเทคอนกรีตเสา');
      expect(plan.tasks[0].is_hold_point).toBe(true);
      expect(plan.tasks[0].weight_score).toBe(5);
    });

    it('flags late handoff tasks appropriately for +2 days scheduling', () => {
      const plan = buildQCDailyInspectionPlan({
        inspectionQueue: mockQueue,
        todayDateStr: '2026-11-21',
      });

      const lateItem = plan.tasks.find(t => t.task_name === 'งานทำความสะอาด');
      expect(lateItem).toBeDefined();
      expect(lateItem?.is_late_handoff).toBe(true);
      expect(lateItem?.target_inspection_date).toBe('2026-11-23'); // +2 days from Nov 21
    });
  });
});
