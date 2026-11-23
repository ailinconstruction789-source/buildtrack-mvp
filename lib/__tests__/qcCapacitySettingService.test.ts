import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getQCCapacityThreshold,
  saveQCCapacityThreshold,
  analyzeQCHistoricalWorkload,
  resetQCCapacityMemory,
} from '@/lib/qc/qcCapacitySettingService';
import type { QCTaskWeight } from '@/lib/qc/qcInspectionPlanService';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { setting_value: 14 }, error: null }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

describe('QC Capacity Setting & Historical Workload Analytics Service', () => {
  beforeEach(() => {
    resetQCCapacityMemory();
  });

  it('1. Reads threshold and falls back safely', async () => {
    const val = await getQCCapacityThreshold();
    expect(val).toBe(14); // mock returned 14
  });

  it('2. Enforces permissions and bounds when saving threshold', async () => {
    // Non-admin role rejected
    const nonAdminRes = await saveQCCapacityThreshold({
      threshold: 12,
      actorUsername: 'foreman_boy',
      actorRole: 'Foreman',
    });
    expect(nonAdminRes.success).toBe(false);

    // Out of bounds rejected (< 6 or > 30)
    const outOfBounds = await saveQCCapacityThreshold({
      threshold: 40,
      actorUsername: 'admin_top',
      actorRole: 'Admin',
    });
    expect(outOfBounds.success).toBe(false);

    // Valid save succeeds
    const validRes = await saveQCCapacityThreshold({
      threshold: 11,
      actorUsername: 'admin_top',
      actorRole: 'Admin',
    });
    expect(validRes.success).toBe(true);
    expect(validRes.threshold).toBe(11);
  });

  it('3. Analyzes historical QC inspection data across Monday to Saturday', () => {
    // Mock updates:
    // 2026-11-16 is Monday
    // 2026-11-17 is Tuesday
    // 2026-11-18 is Wednesday
    const updates = [
      // Monday: 3 tasks of 3 points each = 9 points
      {
        created_at: '2026-11-16T10:00:00Z',
        role: 'QC',
        action: 'QC อนุมัติผ่าน',
        user_name: 'qc_somchai',
        task_template_id: 't_structure',
      },
      {
        created_at: '2026-11-16T11:00:00Z',
        role: 'QC',
        action: 'QC อนุมัติผ่าน',
        user_name: 'qc_somchai',
        task_template_id: 't_structure',
      },
      {
        created_at: '2026-11-16T14:00:00Z',
        role: 'QC',
        action: 'QC แจ้งแก้ไข',
        user_name: 'qc_somchai',
        task_template_id: 't_structure',
      },
      // Tuesday: 1 task of 2 points
      {
        created_at: '2026-11-17T09:00:00Z',
        role: 'QC',
        action: 'QC อนุมัติผ่าน',
        user_name: 'qc_somchai',
        task_template_id: 't_arch',
      },
    ];

    const weightsMap = new Map<string, QCTaskWeight>([
      ['t_structure', { task_template_id: 't_structure', weight_score: 3, is_hold_point: true }],
      ['t_arch', { task_template_id: 't_arch', weight_score: 2, is_hold_point: false }],
    ]);

    const analysis = analyzeQCHistoricalWorkload({
      allUpdatesRecord: updates,
      weightsMap,
      lookbackDays: 60,
    });

    expect(analysis.weekdayStats.length).toBe(6); // Mon to Sat
    const monday = analysis.weekdayStats.find(w => w.dayName === 'จันทร์');
    const tuesday = analysis.weekdayStats.find(w => w.dayName === 'อังคาร');

    expect(monday).toBeDefined();
    expect(monday?.totalPoints).toBe(9);
    expect(monday?.averagePointsPerDay).toBe(9);
    expect(monday?.totalInspections).toBe(3);

    expect(tuesday).toBeDefined();
    expect(tuesday?.totalPoints).toBe(2);
    expect(tuesday?.averagePointsPerDay).toBe(2);

    expect(analysis.peakWeekday).toBe('จันทร์');
    expect(analysis.overallMaxSingleDayPoints).toBe(9);
    expect(analysis.recommendedThreshold).toBeGreaterThanOrEqual(8);
  });
});
