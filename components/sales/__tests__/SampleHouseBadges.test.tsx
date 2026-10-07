import { describe, it, expect, vi } from 'vitest';
import { isSampleHouse, isPlotEligibleForSampleHouse, toggleSampleHouse, fetchTodayInspectionStatus } from '@/lib/sales/sampleHouseHelper';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'house_visit_checklists') {
        return {
          select: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'insp-1',
                project_name: 'ไอลิน6',
                house_or_plot_name: 'A1 (บ้านตัวอย่าง)',
                stage: 'daily_routine_morning',
                customer_name: 'ตรวจเช้า (เปิดบ้าน)',
                agent_name: 'สมศรี มีทรัพย์',
                created_at: new Date().toISOString(),
                checklist_data: { m_cleanliness: true, m_lights_ac: true }
              }
            ],
            error: null
          })
        };
      }
      if (table === 'plots') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null })
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    })
  }
}));

describe('Sample House (บ้านตัวอย่าง) Logic & Inspection Status', () => {
  it('correctly identifies sample houses with multiple criteria', () => {
    expect(isSampleHouse({ is_sample_house: true })).toBe(true);
    expect(isSampleHouse({ sale_status: 'sample_house' })).toBe(true);
    expect(isSampleHouse({ highlight_note: 'sample_house' })).toBe(true);
    expect(isSampleHouse({ plot_name: 'A1 (บ้านตัวอย่าง)' })).toBe(true);
    expect(isSampleHouse({ plot_name: 'A2' })).toBe(false);
    expect(isSampleHouse(null)).toBe(false);
  });

  it('rejects sample house status if plot is transferred or has customer', () => {
    expect(isSampleHouse({ highlight_note: 'sample_house', sale_status: 'transferred' })).toBe(false);
    expect(isSampleHouse({ highlight_note: 'sample_house', has_customer: true })).toBe(false);
    expect(isSampleHouse({ is_sample_house: true, sale_status: 'sold' })).toBe(false);
    expect(isSampleHouse({ is_sample_house: true, sale_status: 'reserved' })).toBe(false);
  });

  it('checks plot eligibility for sample house accurately', () => {
    // Available plot -> eligible
    expect(isPlotEligibleForSampleHouse({ sale_status: 'available' }).eligible).toBe(true);
    expect(isPlotEligibleForSampleHouse({ sale_status: 'ready_for_sale' }).eligible).toBe(true);

    // Transferred / Sold plot -> ineligible
    const transferred = isPlotEligibleForSampleHouse({ sale_status: 'transferred' });
    expect(transferred.eligible).toBe(false);
    expect(transferred.reason).toContain('โอนกรรมสิทธิ์แล้ว');

    // Reserved / Contracted plot -> ineligible
    const booked = isPlotEligibleForSampleHouse({ sale_status: 'reserved' });
    expect(booked.eligible).toBe(false);
    expect(booked.reason).toContain('จอง/ทำสัญญา');

    // Has customer flag -> ineligible
    const hasCustomer = isPlotEligibleForSampleHouse({ has_customer: true, sale_status: 'active' });
    expect(hasCustomer.eligible).toBe(false);

    // Active lead with reserved status -> ineligible
    const activeBooking = isPlotEligibleForSampleHouse({ sale_status: 'active' }, { status: 'Reserved' });
    expect(activeBooking.eligible).toBe(false);
  });

  it('allows toggling sample house for eligible available plot', async () => {
    const res = await toggleSampleHouse('plot-101', true, { sale_status: 'available' });
    expect(res.success).toBe(true);
  });

  it('prevents toggling sample house for transferred or booked plot', async () => {
    const resTransferred = await toggleSampleHouse('plot-102', true, { sale_status: 'transferred' });
    expect(resTransferred.success).toBe(false);
    expect(resTransferred.error).toContain('โอนกรรมสิทธิ์แล้ว');

    const resBooked = await toggleSampleHouse('plot-103', true, { sale_status: 'active' }, { status: 'Contracted' });
    expect(resBooked.success).toBe(false);
    expect(resBooked.error).toContain('จอง/ผูกสัญญา');
  });

  it('fetches today morning inspection status badge correctly', async () => {
    const status = await fetchTodayInspectionStatus('ไอลิน6', 'A1');
    expect(status.isSampleHouse).toBe(true);
    expect(status.status).toBe('morning_checked');
    expect(status.badgeLabel).toContain('เปิดบ้านแล้ว');
    expect(status.inspectorName).toBe('สมศรี มีทรัพย์');
  });
});
