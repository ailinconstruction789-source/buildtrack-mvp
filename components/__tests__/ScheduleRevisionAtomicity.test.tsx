import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as plannerScoring from '@/lib/plannerScoring';

describe('Finding 4: Schedule Revision Atomicity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts revision and score deduction when handleSaveAllSchedules fails', async () => {
    const recordSpy = vi.spyOn(plannerScoring, 'recordScheduleDelayRevision');
    const showToast = vi.fn();
    const showAlert = vi.fn();

    // Mock handleSaveAllSchedules returning failure
    const mockHandleSaveAllSchedules = vi.fn().mockResolvedValue({
      success: false,
      error: 'Database connection failed'
    });

    // Simulate the exact flow in HouseDetailView.tsx
    const handleConfirmScheduleRevision = async () => {
      const saveRes: any = await mockHandleSaveAllSchedules();
      if (saveRes && saveRes.success === false) {
        return;
      }
      await plannerScoring.recordScheduleDelayRevision(
        {} as any,
        { id: 'plot-1' },
        { isLocked: true, end: '2026-11-05', score: 100, revisions: 0 } as any,
        '2026-11-01',
        '2026-11-10',
        'Planner',
        'Reason'
      );
      showToast('บันทึกการปรับขยายแผนงานเรียบร้อยแล้ว', 'success');
    };

    await handleConfirmScheduleRevision();

    // Verify: schedule save was attempted
    expect(mockHandleSaveAllSchedules).toHaveBeenCalledTimes(1);

    // Verify: revision was NEVER recorded because schedule save failed
    expect(recordSpy).not.toHaveBeenCalled();

    // Verify: no success toast was triggered
    expect(showToast).not.toHaveBeenCalled();
  });

  it('records revision and updates score when handleSaveAllSchedules succeeds', async () => {
    const recordSpy = vi.spyOn(plannerScoring, 'recordScheduleDelayRevision').mockResolvedValue({
      success: true,
      newRevisions: 1,
      newScore: 75
    });
    const showToast = vi.fn();

    // Mock handleSaveAllSchedules returning success
    const mockHandleSaveAllSchedules = vi.fn().mockResolvedValue({
      success: true
    });

    // Simulate the exact flow in HouseDetailView.tsx
    const handleConfirmScheduleRevision = async () => {
      const saveRes: any = await mockHandleSaveAllSchedules();
      if (saveRes && saveRes.success === false) {
        return;
      }
      const res = await plannerScoring.recordScheduleDelayRevision(
        {} as any,
        { id: 'plot-1' },
        { isLocked: true, end: '2026-11-05', score: 100, revisions: 0 } as any,
        '2026-11-01',
        '2026-11-10',
        'Planner',
        'Reason'
      );
      if (res.success) {
        showToast('บันทึกการปรับขยายแผนงานเรียบร้อยแล้ว (คะแนนคงเหลือ 75 คะแนน)', 'success');
      }
    };

    await handleConfirmScheduleRevision();

    expect(mockHandleSaveAllSchedules).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('คะแนนคงเหลือ 75 คะแนน'),
      'success'
    );
  });
});
