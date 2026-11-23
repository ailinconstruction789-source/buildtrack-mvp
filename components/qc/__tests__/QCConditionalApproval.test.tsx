import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QCInspectionInlineCard from '../QCInspectionInlineCard';
import { evaluateInspectionAnswers } from '@/lib/qc/qcInspectionService';
import { QCInspection, QCFormItem, QCInspectionAnswer } from '@/types/qc.types';

describe('QC Conditional Approval & PE Review Verification', () => {
  it('correctly evaluates conditional items', () => {
    const items: QCFormItem[] = [
      { id: 'item-1', form_template_id: 't-1', item_order: 1, item_code: 'Q01', item_text: 'ทดสอบ 1', item_type: 'pass_fail_na', is_required: true, is_critical: false, require_remark_on_fail: false, require_photo_on_fail: false },
      { id: 'item-2', form_template_id: 't-1', item_order: 2, item_code: 'Q02', item_text: 'ทดสอบ 2', item_type: 'pass_fail_na', is_required: true, is_critical: false, require_remark_on_fail: false, require_photo_on_fail: false },
    ];

    const answers: QCInspectionAnswer[] = [
      { id: 'a-1', inspection_id: 'insp-1', form_item_id: 'item-1', item_code: 'Q01', item_text: 'ทดสอบ 1', item_type: 'pass_fail_na', is_critical: false, status: 'passed' },
      { id: 'a-2', inspection_id: 'insp-1', form_item_id: 'item-2', item_code: 'Q02', item_text: 'ทดสอบ 2', item_type: 'pass_fail_na', is_critical: false, status: 'conditional', remarks: 'รอเก็บสีรอบสุดท้าย' },
    ];

    const result = evaluateInspectionAnswers(items, answers);
    expect(result.isValid).toBe(true);
    expect(result.overallResult).toBe('conditional');
    expect(result.conditionalItems).toBe(1);
    expect(result.passedItems).toBe(1);
  });

  it('distinguishes "QC ส่งตรวจแบบมีเงื่อนไข (รอ PE อนุมัติ)" from actual PE approval', () => {
    const pendingAction = 'QC ส่งตรวจแบบมีเงื่อนไข (รอ PE อนุมัติ)';
    const approvedAction = 'PE อนุมัติผ่านมีเงื่อนไข';

    const isPendingCompleted = (
      (Boolean(pendingAction && String(pendingAction).includes('PE อนุมัติ')) && !String(pendingAction).includes('รอ PE อนุมัติ'))
    );
    expect(isPendingCompleted).toBe(false);

    const isApprovedCompleted = (
      (Boolean(approvedAction && String(approvedAction).includes('PE อนุมัติ')) && !String(approvedAction).includes('รอ PE อนุมัติ'))
    );
    expect(isApprovedCompleted).toBe(true);
  });

  it('renders PE review button on QCInspectionInlineCard when status is pending_pe', () => {
    const mockOnOpenReview = vi.fn();
    const mockInspection: QCInspection = {
      id: 'insp-pe-1',
      project_name: 'The Valley',
      plot_id: '15',
      task_template_id: 'task-62',
      task_name: 'งานปูหญ้า',
      round_number: 1,
      inspection_method: 'form_v2',
      form_template_id: 'form-1',
      form_version: 1,
      form_title: 'งานปูหญ้า',
      inspector_name: 'QC Inspector',
      inspector_role: 'QC',
      document_status: 'pending_pe',
      inspection_result: 'conditional',
      total_items: 3,
      passed_items: 0,
      failed_items: 0,
      conditional_items: 1,
      na_items: 2,
      answers: [
        {
          id: 'ans-1',
          inspection_id: 'insp-pe-1',
          form_item_id: 'q1',
          item_code: 'Q01',
          item_text: 'ปูหญ้าเต็มพื้นที่',
          item_type: 'pass_fail_na',
          is_critical: false,
          status: 'conditional',
          remarks: 'รอเก็บขอบ'
        }
      ],
      annotations: [],
      photo_urls: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    render(
      <QCInspectionInlineCard
        inspection={mockInspection}
        onOpenReview={mockOnOpenReview}
      />
    );

    const peBtn = screen.getByRole('button', { name: /พิจารณาอนุมัติ \(PE\)/i });
    expect(peBtn).toBeInTheDocument();

    fireEvent.click(peBtn);
    expect(mockOnOpenReview).toHaveBeenCalledTimes(1);
    expect(mockOnOpenReview).toHaveBeenCalledWith(mockInspection);
  });
});
