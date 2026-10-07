import { postBookingResultStage, postBookingTargets, type PostBookingInput, type PostBookingResult, type PostBookingSnapshot } from '@/lib/sales/postBookingContracts';
import type { PaymentMethod, SaleStage } from '@/lib/sales/workflow';

export const actorId = '10000000-0000-4000-8000-000000000001';
export const customerId = '10000000-0000-4000-8000-000000000002';
export const saleId = '10000000-0000-4000-8000-000000000003';
export const interestId = '10000000-0000-4000-8000-000000000004';
export const revisionId = '10000000-0000-4000-8000-000000000005';
export const attemptId = '10000000-0000-4000-8000-000000000006';
export const eventId = '10000000-0000-4000-8000-000000000007';
export const otherSaleId = '10000000-0000-4000-8000-000000000008';
export const nextRevisionId = '10000000-0000-4000-8000-000000000009';
export const otherActorId = '10000000-0000-4000-8000-000000000010';
export const advanceInput: PostBookingInput = { requestId: '10000000-0000-4000-8000-000000000011', command: 'advance', nextStage: 'contracted',
  customerId, saleId, expectedSaleRevision: revisionId, expectedInterestRevision: revisionId,
  reason: 'ลูกค้าลงนามแล้ว', evidenceNote: 'สัญญาเลขที่ทดสอบ 01', occurredAt: '2026-09-21T10:00:00+07:00' };
export const transferInput: PostBookingInput = { requestId: '10000000-0000-4000-8000-000000000012', command: 'confirm_transfer',
  customerId, saleId, expectedSaleRevision: revisionId, expectedInterestRevision: revisionId,
  reason: 'โอนกรรมสิทธิ์เสร็จแล้ว', transferDate: '2026-09-21' };
export function postBookingSnapshot(stage: SaleStage = 'booked', paymentMethod: PaymentMethod | null = 'mortgage'): PostBookingSnapshot {
  const hasLoan = ['loan_submitted', 'loan_rejected', 'loan_approved'].includes(stage);
  const latestAttempt: PostBookingSnapshot['latestAttempt'] = hasLoan ? { id: attemptId, saleId, interestId, attemptNumber: 1, bankName: 'ธนาคารทดสอบ',
    status: stage === 'loan_rejected' ? 'rejected' : stage === 'loan_approved' ? 'approved' : 'submitted',
    submittedAt: '2026-09-21T09:00:00+07:00', resultAt: stage === 'loan_submitted' ? null : '2026-09-21T10:00:00+07:00',
    resultReason: stage === 'loan_rejected' ? 'เอกสารไม่ครบ' : null, approvedAmount: stage === 'loan_approved' ? 1900000 : null, recordedByUserId: actorId } : null;
  return { actor: { userId: actorId, role: 'sales' }, sale: { id: saleId, customerId, customerName: 'ลูกค้าทดสอบ', interestId,
    projectName: 'โครงการทดสอบ A', plotId: 'A-01', stage, paymentMethod, bookedAt: null, contractedAt: null, transferDate: null,
    revision: revisionId, interestRevision: revisionId, ownerUserId: actorId, canEdit: postBookingTargets(stage, paymentMethod).length > 0 },
    latestAttempt, attempts: latestAttempt ? [latestAttempt] : [], attemptPage: 0, attemptsHasMore: false, eventPage: 0, eventsHasMore: false,
    events: [{ id: eventId, command: 'advance', fromStage: 'booked', toStage: 'contracted', occurredAt: '2026-09-21T10:00:00+07:00',
      recordedAt: '2026-09-21T10:05:00+07:00', actorUserId: actorId, reason: 'ลูกค้าลงนามแล้ว', evidenceNote: 'สัญญาเลขที่ทดสอบ 01', loanAttemptId: null, transferDate: null }] };
}
export function transferredSnapshot(): PostBookingSnapshot {
  const snapshot = postBookingSnapshot('transferred', 'cash'); snapshot.sale.transferDate = '2026-09-21';
  snapshot.events = [{ id: eventId, command: 'confirm_transfer', fromStage: 'transfer_pending', toStage: 'transferred',
    occurredAt: null, recordedAt: '2026-09-23T11:30:00+07:00', actorUserId: actorId, reason: 'โอนกรรมสิทธิ์เสร็จแล้ว',
    evidenceNote: null, loanAttemptId: null, transferDate: '2026-09-21' }];
  return snapshot;
}
export function postBookingResult(input: PostBookingInput = advanceInput): PostBookingResult {
  return { requestId: input.requestId, command: input.command, customerId: input.customerId, interestId, saleId: input.saleId,
    saleRevision: nextRevisionId, stage: postBookingResultStage(input), eventId,
    loanAttemptId: input.command === 'advance' || input.command === 'confirm_transfer' ? null : input.command === 'loan_result' ? input.loanAttemptId : attemptId,
    transferDate: input.command === 'confirm_transfer' ? input.transferDate : null, replayed: false };
}
