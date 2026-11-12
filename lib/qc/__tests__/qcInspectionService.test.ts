// ==============================================================================
// 🧪 BUILDTRACK: TESTS FOR QC INSPECTION SERVICE
// ==============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  evaluateInspectionAnswers, 
  saveInspectionDraft, 
  submitInspection, 
  approveInspection, 
  createRetestRound, 
  reopenInspection 
} from '../qcInspectionService';
import { QCFormItem, QCInspectionAnswer, QCDrawingAnnotation, QCInspection } from '@/types/qc.types';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn()
  }
}));

describe('QC Form Evaluation Logic', () => {
  const sampleItems: QCFormItem[] = [
    {
      id: 'item-1',
      form_template_id: 'tmpl-1',
      item_order: 1,
      item_code: 'Q01',
      item_text: 'ตรวจแนวดิ่งผนัง',
      item_type: 'pass_fail_na',
      is_required: true,
      is_critical: true,
      require_remark_on_fail: true,
      require_photo_on_fail: false
    },
    {
      id: 'item-2',
      form_template_id: 'tmpl-1',
      item_order: 2,
      item_code: 'Q02',
      item_text: 'ความหนาปูนก่อ',
      item_type: 'number',
      is_required: true,
      is_critical: false,
      require_remark_on_fail: false,
      require_photo_on_fail: false,
      unit: 'มม.',
      target_value: 15,
      min_value: 10,
      max_value: 20
    },
    {
      id: 'item-3',
      form_template_id: 'tmpl-1',
      item_order: 3,
      item_code: 'Q03',
      item_text: 'จุดต่อเสากับผนัง (ปักหมุด)',
      item_type: 'drawing_point',
      is_required: true,
      is_critical: false,
      require_remark_on_fail: false,
      require_photo_on_fail: false
    }
  ];

  it('rejects form if required items are uninspected (distinguishes uninspected from na)', () => {
    const answers: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-1',
        item_code: 'Q01',
        item_text: 'ตรวจแนวดิ่งผนัง',
        item_type: 'pass_fail_na',
        is_critical: true,
        status: 'uninspected' // Not inspected yet
      }
    ];

    const result = evaluateInspectionAnswers(sampleItems, answers);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.message.includes('ยังไม่ได้ทำการตรวจ'))).toBe(true);
  });

  it('accepts 0, negative numbers, and decimals properly without falsy check bug', () => {
    const itemsWithZeroTolerance: QCFormItem[] = [
      {
        id: 'item-num',
        form_template_id: 'tmpl-1',
        item_order: 1,
        item_code: 'Q-DIFF',
        item_text: 'ค่าเบี่ยงเบนระดับ',
        item_type: 'number',
        is_required: true,
        is_critical: false,
        require_remark_on_fail: false,
        require_photo_on_fail: false,
        unit: 'มม.',
        min_value: -5,
        max_value: 5
      }
    ];

    // Case 1: Value is 0 (Valid! Must not be treated as empty)
    const answersZero: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-num',
        item_code: 'Q-DIFF',
        item_text: 'ค่าเบี่ยงเบนระดับ',
        item_type: 'number',
        is_critical: false,
        status: 'passed',
        numeric_value: 0
      }
    ];
    const resZero = evaluateInspectionAnswers(itemsWithZeroTolerance, answersZero);
    expect(resZero.isValid).toBe(true);
    expect(resZero.overallResult).toBe('passed');

    // Case 2: Value is negative -2.5 (Valid within -5 to 5)
    const answersNeg: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-num',
        item_code: 'Q-DIFF',
        item_text: 'ค่าเบี่ยงเบนระดับ',
        item_type: 'number',
        is_critical: false,
        status: 'passed',
        numeric_value: -2.5
      }
    ];
    const resNeg = evaluateInspectionAnswers(itemsWithZeroTolerance, answersNeg);
    expect(resNeg.isValid).toBe(true);
    expect(resNeg.overallResult).toBe('passed');

    // Case 3: Value is -8 (Out of bounds)
    const answersOutOfBound: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-num',
        item_code: 'Q-DIFF',
        item_text: 'ค่าเบี่ยงเบนระดับ',
        item_type: 'number',
        is_critical: false,
        status: 'passed',
        numeric_value: -8
      }
    ];
    const resOut = evaluateInspectionAnswers(itemsWithZeroTolerance, answersOutOfBound);
    expect(resOut.overallResult).toBe('failed');
  });

  it('fails overall inspection if a critical item fails (never averaged out)', () => {
    const answers: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-1',
        item_code: 'Q01',
        item_text: 'ตรวจแนวดิ่งผนัง',
        item_type: 'pass_fail_na',
        is_critical: true,
        status: 'failed',
        remarks: 'แนวดิ่งเบี้ยวเกิน 10 มม.'
      },
      {
        form_item_id: 'item-2',
        item_code: 'Q02',
        item_text: 'ความหนาปูนก่อ',
        item_type: 'number',
        is_critical: false,
        status: 'passed',
        numeric_value: 15
      },
      {
        form_item_id: 'item-3',
        item_code: 'Q03',
        item_text: 'จุดต่อเสากับผนัง',
        item_type: 'drawing_point',
        is_critical: false,
        status: 'passed'
      }
    ];

    const annotations: QCDrawingAnnotation[] = [
      {
        form_item_id: 'item-3',
        page_number: 1,
        pin_label: 'P01',
        x_ratio: 0.5,
        y_ratio: 0.5,
        status: 'passed'
      }
    ];

    const result = evaluateInspectionAnswers(sampleItems, answers, annotations);
    expect(result.isValid).toBe(true);
    expect(result.overallResult).toBe('failed');
    expect(result.criticalFailedItems).toBe(1);
  });

  it('requires remarks when require_remark_on_fail is true', () => {
    const answers: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-1',
        item_code: 'Q01',
        item_text: 'ตรวจแนวดิ่งผนัง',
        item_type: 'pass_fail_na',
        is_critical: true,
        status: 'failed',
        remarks: '' // Empty remark!
      }
    ];

    const result = evaluateInspectionAnswers(sampleItems, answers);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.message.includes('จำเป็นต้องระบุหมายเหตุ/ข้อบกพร่อง'))).toBe(true);
  });
});

describe('Retest Round Creation', () => {
  it('creates next round inheriting form and drawing version from round 1', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'insp-round-2' },
          error: null
        })
      })
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections') {
        return { insert: mockInsert } as any;
      }
      if (table === 'qc_inspection_answers' || table === 'qc_audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: [], error: null }) } as any;
      }
      return {} as any;
    });

    const previousInspection: QCInspection = {
      id: 'insp-round-1',
      project_name: 'The Palm',
      plot_id: 'PLOT-01',
      task_template_id: 'TASK-01',
      task_name: 'งานก่อผนัง',
      round_number: 1,
      inspection_method: 'form_v2',
      form_template_id: 'tmpl-1',
      form_version: 2,
      form_title: 'แบบฟอร์มก่อผนัง',
      drawing_id: 'draw-1',
      drawing_version: 3,
      drawing_title: 'แปลนชั้น 1',
      inspector_name: 'Somchai',
      inspector_role: 'QC',
      document_status: 'rejected',
      inspection_result: 'failed',
      total_items: 5,
      passed_items: 3,
      failed_items: 2,
      na_items: 0
    };

    const previousAnswers: QCInspectionAnswer[] = [
      {
        form_item_id: 'item-1',
        item_code: 'Q01',
        item_text: 'แนวระดับ',
        item_type: 'pass_fail_na',
        is_critical: false,
        status: 'passed'
      },
      {
        form_item_id: 'item-2',
        item_code: 'Q02',
        item_text: 'แนวดิ่ง',
        item_type: 'pass_fail_na',
        is_critical: true,
        status: 'failed',
        remarks: 'เอียง 8 มม.'
      }
    ];

    const result = await createRetestRound({
      previousInspection,
      previousAnswers,
      actorUsername: 'Somchai',
      actorRole: 'QC'
    });

    expect(result.success).toBe(true);
    expect(result.newInspectionId).toBe('insp-round-2');

    // Verify insert payload locked versions and round number
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        round_number: 2,
        form_version: 2, // Locked from round 1!
        drawing_version: 3, // Locked from round 1!
        previous_inspection_id: 'insp-round-1'
      })
    ]);
  });
});

describe('Reopening Approved Inspection', () => {
  it('blocks reopening if actor is not Admin or Owner', async () => {
    const result = await reopenInspection({
      inspectionId: 'insp-1',
      reason: 'ต้องการตรวจซ้ำเนื่องจากเปลี่ยนช่าง',
      actorUsername: 'ForemanJohn',
      actorRole: 'Foreman'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ไม่มีสิทธิ์');
  });

  it('requires a mandatory reason to reopen', async () => {
    const result = await reopenInspection({
      inspectionId: 'insp-1',
      reason: '   ',
      actorUsername: 'AdminUser',
      actorRole: 'Admin'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('จำเป็นต้องระบุเหตุผล');
  });
});
