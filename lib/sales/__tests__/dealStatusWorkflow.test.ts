import { describe, expect, it } from 'vitest';
import { salesDealNextStages, salesDealPaymentMethodOf, salesDealStageOf, salesDealTransitionError, salesDealActionLabel } from '../dealStatus';
const evidence = { bank: 'กสิกรไทย', reason: 'Customer decision', date: '2026-10-09', confirmed: true, saleId: 'S1' };
describe('native shared post-booking workflow rules', () => {
  it.each([
    ['booked', 'mortgage', ['contracted', 'cancelled']],
    ['contracted', 'mortgage', ['downpayment', 'document_prep', 'cancelled']],
    ['contracted', 'cash', ['downpayment', 'document_prep', 'transfer_pending', 'cancelled']],
    ['document_prep', 'cash', ['transfer_pending', 'cancelled']],
    ['document_prep', 'mortgage', ['loan_submitted', 'cancelled']],
    ['loan_submitted', 'mortgage', ['loan_rejected', 'loan_approved', 'cancelled']],
    ['loan_rejected', 'mortgage', ['document_prep', 'cancelled']],
    ['loan_approved', 'mortgage', ['transfer_pending', 'cancelled']],
    ['transfer_pending', 'mortgage', ['transferred', 'cancelled']],
    ['transferred', 'mortgage', ['handover']],
    ['handover', 'mortgage', []], ['cancelled', 'cash', []],
  ])('offers valid next steps from %s using %s', (stage, method, expected) => {
    expect(salesDealNextStages(stage as string, method as string)).toEqual(expected);
  });
  it.each(['', 'ซื้อเงินสด'])('requires a real bank for mortgage submission: %s', bank => {
    expect(salesDealTransitionError('document_prep', 'loan_submitted', 'mortgage', { ...evidence, bank })).toContain('ธนาคาร');
  });
  it.each(['loan_rejected', 'cancelled'])('requires a reason for %s', target => {
    expect(salesDealTransitionError('loan_submitted', target, 'mortgage', { ...evidence, reason: ' ' })).toContain('เหตุผล');
  });
  it.each(['2026-02-30', '2026-13-01', '', '2026-10-9'])('rejects invalid transaction dates: %s', date => {
    expect(salesDealTransitionError('transfer_pending', 'transferred', 'mortgage', { ...evidence, date })).toContain('วันที่');
  });
  it('requires linked sale and confirmation for terminal transitions', () => {
    expect(salesDealTransitionError('transferred', 'handover', 'cash', { ...evidence, saleId: null })).toContain('เชื่อม');
    expect(salesDealTransitionError('transferred', 'handover', 'cash', { ...evidence, confirmed: false })).toContain('ยืนยัน');
    expect(salesDealTransitionError('transferred', 'handover', 'cash', evidence)).toBeNull();
    expect(salesDealTransitionError('transferred', 'cancelled', 'cash', evidence)).toContain('ขั้นตอน');
  });
  it('does not allow cash to retain or enter a mortgage stage', () => {
    expect(salesDealTransitionError('loan_submitted', 'loan_submitted', 'cash', evidence)).toContain('เงินสด');
    expect(salesDealTransitionError('document_prep', 'loan_submitted', 'cash', evidence)).toContain('เงินสด');
  });
  it('infers legacy cash but respects structured method', () => {
    expect(salesDealPaymentMethodOf({ bank_name: 'ซื้อเงินสด' })).toBe('cash');
    expect(salesDealPaymentMethodOf({ notes: '• วิธีชำระเงิน: เงินสด' })).toBe('cash');
    expect(salesDealPaymentMethodOf({ payment_method: 'mortgage', bank_name: 'ซื้อเงินสด' })).toBe('mortgage');
  });
  it('uses the newest payment note instead of an older cash history', () => {
    expect(salesDealPaymentMethodOf({ notes: '• วิธีชำระเงิน: กู้ธนาคาร\n\n• วิธีชำระเงิน: เงินสด' })).toBe('mortgage');
    expect(salesDealPaymentMethodOf({ bank_name: 'กสิกรไทย', notes: 'เงินจองที่รับ: 5,000 (เงินสด)' })).toBe('mortgage');
  });
  it('keeps rejection active and terminal structured statuses stronger than stale progress', () => {
    expect(salesDealStageOf({ status: 'Contracted', crm_status: 'Contracted — สินเชื่อไม่ผ่าน รอยื่นใหม่' })).toBe('loan_rejected');
    expect(salesDealStageOf({ contract_status: 'Cancelled', crm_stage: 'booked' })).toBe('cancelled');
    expect(salesDealStageOf({ status: 'Transferred', crmStage: 'document_prep' })).toBe('transferred');
    expect(salesDealStageOf({ status: 'Transferred', crmStage: 'handover' })).toBe('handover');
  });
  it('labels the handover action only for editable native records', () => {
    expect(salesDealActionLabel({ status: 'Transferred', leadId: 'L1' }, true)).toBe('อัปเดตส่งมอบ');
    expect(salesDealActionLabel({ status: 'Transferred', id: 'registry-only' }, true)).toBe('ดูสถานะ');
    expect(salesDealActionLabel({ intakeStatus: 'transferred', id: 'registry-only' }, true)).toBe('ดูสถานะ');
    expect(salesDealActionLabel({ status: 'Handover', leadId: 'L1' }, true)).toBe('ดูสถานะ');
    expect(salesDealActionLabel({ status: 'Transferred', leadId: 'L1' }, false)).toBe('ดูสถานะ');
  });
});
