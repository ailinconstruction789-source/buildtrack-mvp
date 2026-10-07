import type { PostBookingInput, PostBookingResult, PostBookingScope, PostBookingSnapshot, PurchaseLoanAttempt } from '../postBookingContracts';
export const pbid = (n: number) => `21000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const pbScope = (patch: Partial<PostBookingScope> = {}): PostBookingScope => ({ saleId: pbid(1), attemptPage: 0, eventPage: 0, ...patch });
const pbBase = () => ({ requestId: pbid(8), customerId: pbid(2), saleId: pbid(1),
  expectedSaleRevision: pbid(3), expectedInterestRevision: pbid(4), reason: 'ลูกค้าทำสัญญาแล้ว', evidenceNote: 'บันทึกอ้างอิงสัญญาสมมติ A1',
  occurredAt: '2026-09-23T10:00:00.123456+07:00' });
export const pbInput = (): Extract<PostBookingInput, { command: 'advance' }> => ({ ...pbBase(), command: 'advance', nextStage: 'contracted' });
export const pbSubmit = (): Extract<PostBookingInput, { command: 'submit_loan' }> => ({ ...pbBase(), command: 'submit_loan', bankName: 'ธนาคารสมมติ' });
export const pbLoanResult = (): Extract<PostBookingInput, { command: 'loan_result' }> => ({ ...pbBase(), command: 'loan_result', loanAttemptId: pbid(9), result: 'approved', approvedAmountSatang: 180000000 });
export const pbTransfer = (): Extract<PostBookingInput, { command: 'confirm_transfer' }> => ({ requestId: pbid(8), command: 'confirm_transfer',
  customerId: pbid(2), saleId: pbid(1), expectedSaleRevision: pbid(3), expectedInterestRevision: pbid(4), reason: 'ลูกค้าโอนจริงแล้ว', transferDate: '2026-09-23' });
export const pbResult = (input: PostBookingInput = pbInput(), replayed = false): PostBookingResult => ({ requestId: input.requestId, command: input.command,
  customerId: input.customerId, interestId: pbid(5), saleId: input.saleId, saleRevision: pbid(7), eventId: pbid(10), replayed,
  stage: input.command === 'confirm_transfer' ? 'transferred' : input.command === 'advance' ? input.nextStage : input.command === 'submit_loan' ? 'loan_submitted' : input.result === 'approved' ? 'loan_approved' : 'loan_rejected',
  transferDate: input.command === 'confirm_transfer' ? input.transferDate : null,
  loanAttemptId: input.command === 'advance' || input.command === 'confirm_transfer' ? null : input.command === 'loan_result' ? input.loanAttemptId : pbid(9) });
export const pbAttempt = (patch: Partial<PurchaseLoanAttempt> = {}): PurchaseLoanAttempt => ({ id: pbid(9), saleId: pbid(1), interestId: pbid(5),
  attemptNumber: 1, bankName: 'ธนาคารสมมติ', status: 'submitted', submittedAt: '2026-09-23T10:00:00+07:00', resultAt: null, resultReason: null,
  approvedAmount: null, recordedByUserId: pbid(6), ...patch });
export const pbSnapshot = (scope = pbScope()): PostBookingSnapshot => ({ actor: { userId: pbid(6), role: 'sales' },
  sale: { id: scope.saleId, customerId: pbid(2), customerName: 'ลูกค้าสมมติ', interestId: pbid(5), projectName: 'โครงการ A', plotId: 'A1',
    stage: 'booked', paymentMethod: 'mortgage', bookedAt: '2026-09-22T12:00:00+07:00', contractedAt: null, transferDate: null, revision: pbid(3),
    interestRevision: pbid(4), ownerUserId: pbid(6), canEdit: true },
  latestAttempt: null, attempts: [], attemptPage: scope.attemptPage, attemptsHasMore: false, events: [], eventPage: scope.eventPage, eventsHasMore: false });
