import { describe, expect, it } from 'vitest';
import {
    activateProjectInterest, appendLoanAttempt, canEditCustomer, canEditInterest, canReadCrm,
    resolveNewCustomerOwner, validateChecklistCompletion, validateChecklistItem,
    validateCustomerIntake, validateInterestStatusChange, validateOwnerAssignment,
    validateReason, validateSaleTransition, validateVisitCompletion,
    type CentralCustomer, type CrmActor, type LoanAttempt, type ProjectInterest,
    type SaleRecord, type SaleStage, type VoiceSubmissionEvidence, type WorkflowResult,
} from '../workflow';

const salesA: CrmActor = { userId: 'sales-a', role: 'sales', active: true };
const salesB: CrmActor = { userId: 'sales-b', role: 'sales', active: true };
const admin: CrmActor = { userId: 'admin', role: 'admin', active: true };
const owner: CrmActor = { userId: 'owner', role: 'owner', active: true };
const customer: CentralCustomer = { id: 'customer', ownerUserId: salesA.userId, intakeStatus: 'new' };
const interest: ProjectInterest = {
    id: 'interest-a', customerId: customer.id, projectName: 'Project A',
    ownerUserId: salesA.userId, workspaceState: 'central_interest', engagementStatus: 'new',
};
const sale: SaleRecord = { id: 'sale-a', interestId: interest.id, plotId: 'plot-a', stage: 'booked', paymentMethod: 'mortgage' };
const reason = 'ลูกค้ายืนยันขั้นตอน';
const voice: VoiceSubmissionEvidence = {
    id: 'voice-1', visitId: 'visit-1', state: 'submitted', formVersion: 'v1',
    submittedAt: '2026-09-15T03:00:00Z', validatedAt: '2026-09-15T03:00:01Z',
    submittedByCustomer: true, requiredAnswersValid: true,
};

function expectError(result: WorkflowResult<unknown>, code: string) {
    expect(result).toMatchObject({ ok: false, code });
}

function transition(from: SaleStage, to: SaleStage, paymentMethod: 'cash' | 'mortgage' = 'mortgage') {
    return validateSaleTransition({ actor: salesA, interest, sale: { ...sale, stage: from, paymentMethod }, nextStage: to, reason });
}

describe('central intake and scoped ownership', () => {
    it('accepts name and phone without requiring a project', () => {
        expect(validateCustomerIntake({ name: ' ลูกค้า ', phone: ' 081-234-5678 ' })).toEqual({ ok: true, value: { name: 'ลูกค้า', phone: '081-234-5678' } });
    });

    it.each([
        [{ name: ' ', phone: '0812345678' }, 'NAME_REQUIRED'],
        [{ name: 'ลูกค้า', phone: ' ' }, 'PHONE_REQUIRED'],
        [{ name: 'ลูกค้า', phone: 'ไม่มีเบอร์' }, 'PHONE_REQUIRED'],
    ] as const)('requires minimum contact information (%j)', (input, code) => {
        expectError(validateCustomerIntake(input), code);
    });

    it('automatically assigns a new Sales-created lead to its creator', () => {
        expect(resolveNewCustomerOwner(salesA)).toEqual({ ok: true, value: salesA.userId });
        expectError(resolveNewCustomerOwner(salesA, salesB), 'FORBIDDEN');
    });

    it('requires an active Sales assignee when Admin creates on behalf of Sales', () => {
        expectError(resolveNewCustomerOwner(admin), 'SALES_OWNER_REQUIRED');
        expectError(resolveNewCustomerOwner(admin, owner), 'SALES_OWNER_REQUIRED');
        expectError(resolveNewCustomerOwner(admin, { ...salesA, active: false }), 'SALES_OWNER_REQUIRED');
        expect(resolveNewCustomerOwner(admin, salesB)).toEqual({ ok: true, value: salesB.userId });
        expectError(resolveNewCustomerOwner(owner), 'FORBIDDEN');
    });

    it.each([salesA, salesB, admin, owner])('allows active $role to read without project membership', actor => {
        expect(canReadCrm(actor)).toBe(true);
    });

    it('separates central and project owners; the executive Owner is read-only', () => {
        const projectOwnedByB = { ...interest, ownerUserId: salesB.userId };
        expect(canEditCustomer(salesA, customer)).toBe(true);
        expect(canEditInterest(salesA, projectOwnedByB)).toBe(false);
        expect(canEditCustomer(salesB, customer)).toBe(false);
        expect(canEditInterest(salesB, projectOwnedByB)).toBe(true);
        expect(canEditCustomer(admin, customer)).toBe(true);
        expect(canEditInterest(admin, projectOwnedByB)).toBe(true);
        expect(canEditCustomer(owner, { ...customer, ownerUserId: owner.userId })).toBe(false);
        expect(canEditInterest(owner, { ...interest, ownerUserId: owner.userId })).toBe(false);
    });

    it('denies inactive and unidentified actors', () => {
        expect(canReadCrm({ ...admin, active: false })).toBe(false);
        expect(canEditCustomer({ ...admin, userId: '' }, customer)).toBe(false);
        expectError(resolveNewCustomerOwner({ ...salesA, active: false }), 'FORBIDDEN');
    });

    it('allows only Admin to reassign, to active Sales, with a reason', () => {
        expectError(validateOwnerAssignment(salesA, salesB, reason), 'FORBIDDEN');
        expectError(validateOwnerAssignment(owner, salesB, reason), 'FORBIDDEN');
        expectError(validateOwnerAssignment(admin, salesB, ' '), 'REASON_REQUIRED');
        expectError(validateOwnerAssignment(admin, { ...salesB, active: false }, reason), 'SALES_OWNER_REQUIRED');
        expect(validateOwnerAssignment(admin, salesB, reason)).toEqual({ ok: true, value: salesB.userId });
    });

    it('activates just the visited project without mutating central data or another interest', () => {
        const anotherInterest = { ...interest, id: 'interest-b', projectName: 'Project B' };
        const result = activateProjectInterest(salesA, interest, 'visit', reason);
        expect(result).toEqual({ ok: true, value: { ...interest, workspaceState: 'project_active' } });
        expect(interest.workspaceState).toBe('central_interest');
        expect(anotherInterest.workspaceState).toBe('central_interest');
        expect(customer.intakeStatus).toBe('new');
        expectError(activateProjectInterest(salesB, interest, 'booking', reason), 'FORBIDDEN');
        expectError(activateProjectInterest(salesA, interest, 'booking', ''), 'REASON_REQUIRED');
    });

    it('uses Lost only before any booking in that interest', () => {
        expect(validateInterestStatusChange(salesA, interest, 'lost', reason, []).ok).toBe(true);
        expectError(validateInterestStatusChange(salesA, interest, 'lost', reason, [{ ...sale, stage: 'cancelled' }]), 'BOOKING_HISTORY_EXISTS');
        expect(validateInterestStatusChange(salesA, interest, 'lost', reason, [{ ...sale, interestId: 'other' }]).ok).toBe(true);
        expectError(validateInterestStatusChange(salesB, interest, 'lost', reason, []), 'FORBIDDEN');
        expectError(validateInterestStatusChange(salesA, interest, 'considering', '', []), 'REASON_REQUIRED');
    });
});

describe('per-sale state machine', () => {
    it.each([
        ['booked', 'contracted'], ['contracted', 'downpayment'], ['downpayment', 'document_prep'],
        ['loan_submitted', 'loan_rejected'], ['loan_submitted', 'loan_approved'],
        ['loan_approved', 'transfer_pending'], ['transfer_pending', 'transferred'], ['transferred', 'handover'],
    ] as const)('allows normal mortgage transition %s → %s', (from, to) => {
        expect(transition(from, to)).toEqual({ ok: true, value: to });
    });

    it.each(['contracted', 'downpayment', 'document_prep'] as const)('allows cash to bypass loans from %s', from => {
        expect(transition(from, 'transfer_pending', 'cash').ok).toBe(true);
        expectError(transition(from, 'transfer_pending', 'mortgage'), 'LOAN_REQUIRED');
    });

    it('does not invent loan approval for cash purchases', () => {
        expectError(transition('document_prep', 'loan_submitted', 'cash'), 'CASH_LOAN_NOT_ALLOWED');
    });

    it.each(['transferred', 'handover', 'cancelled'] as const)('does not reopen or normally cancel a %s sale', from => {
        expectError(transition(from, 'booked'), 'ILLEGAL_TRANSITION');
        if (from !== 'cancelled') expectError(transition(from, 'cancelled'), 'ILLEGAL_TRANSITION');
    });

    it('permits pre-transfer cancellation but not arbitrary jumps or no-op changes', () => {
        expect(transition('loan_rejected', 'cancelled').ok).toBe(true);
        expect(transition('transfer_pending', 'cancelled').ok).toBe(true);
        expectError(transition('booked', 'transferred'), 'ILLEGAL_TRANSITION');
        expectError(transition('booked', 'booked'), 'UNCHANGED_STATUS');
    });

    it('enforces reason, owning interest and Sales/Admin permissions', () => {
        const input = { actor: salesA, interest, sale, nextStage: 'contracted' as const, reason };
        expectError(validateSaleTransition({ ...input, reason: ' ' }), 'REASON_REQUIRED');
        expectError(validateSaleTransition({ ...input, actor: salesB }), 'FORBIDDEN');
        expectError(validateSaleTransition({ ...input, actor: owner }), 'FORBIDDEN');
        expectError(validateSaleTransition({ ...input, interest: { ...interest, id: 'other' } }), 'RELATION_MISMATCH');
        expect(validateSaleTransition({ ...input, actor: admin }).ok).toBe(true);
    });

    it('rejects unknown runtime statuses instead of falling through', () => {
        expectError(transition('booked', 'Reserved' as SaleStage), 'INVALID_STATUS');
        expectError(transition('Reserved' as SaleStage, 'booked'), 'INVALID_STATUS');
    });
});

describe('new loan attempts preserve rejected history', () => {
    const rejectedSale = { ...sale, stage: 'loan_rejected' as const };
    const rejected: LoanAttempt = { id: 'loan-1', saleId: sale.id, attemptNumber: 1, status: 'rejected' };
    const next: LoanAttempt = { id: 'loan-2', saleId: sale.id, attemptNumber: 2, status: 'submitted' };

    it('appends a fresh attempt without modifying a frozen previous record', () => {
        const history = Object.freeze([Object.freeze({ ...rejected })]);
        const result = appendLoanAttempt(rejectedSale, history, next);
        expect(result).toEqual({ ok: true, value: [rejected, next] });
        expect(history).toEqual([rejected]);
        expect(validateSaleTransition({ actor: salesA, interest, sale: rejectedSale, nextStage: 'loan_submitted', reason, loanHistory: history, newLoanAttempt: next }).ok).toBe(true);
    });

    it('requires a new attempt for both first submission and resubmission', () => {
        expectError(transition('document_prep', 'loan_submitted'), 'NEW_LOAN_ATTEMPT_REQUIRED');
        expectError(transition('loan_rejected', 'loan_submitted'), 'NEW_LOAN_ATTEMPT_REQUIRED');
        expect(appendLoanAttempt({ ...sale, stage: 'document_prep' }, [], { ...next, attemptNumber: 1 }).ok).toBe(true);
    });

    it('rejects duplicate IDs, duplicate numbers and attempts for another sale', () => {
        expectError(appendLoanAttempt(rejectedSale, [rejected], { ...next, id: rejected.id }), 'DUPLICATE_LOAN_ATTEMPT');
        expectError(appendLoanAttempt(rejectedSale, [rejected], { ...next, attemptNumber: 1 }), 'DUPLICATE_LOAN_ATTEMPT');
        expectError(appendLoanAttempt(rejectedSale, [rejected], { ...next, saleId: 'sale-b' }), 'RELATION_MISMATCH');
        expectError(appendLoanAttempt(rejectedSale, [rejected], { ...next, attemptNumber: 9 }), 'INVALID_LOAN_ATTEMPT');
        expectError(appendLoanAttempt(rejectedSale, [], { ...next, attemptNumber: 1 }), 'INVALID_LOAN_ATTEMPT');
    });

    it('does not use another plot purchase history as the current attempt sequence', () => {
        const otherSaleLoan = { ...rejected, id: 'loan-other', saleId: 'other-sale', attemptNumber: 20 };
        expect(appendLoanAttempt(rejectedSale, [rejected, otherSaleLoan], next).ok).toBe(true);
        expectError(appendLoanAttempt({ ...rejectedSale, stage: 'transferred' }, [rejected], next), 'ILLEGAL_TRANSITION');
    });
});

describe('Visit completion is independent of SOP', () => {
    const visit = { id: 'visit-1', interestId: interest.id, status: 'awaiting_voice' as const };

    it('accepts only submitted and validated customer evidence for this Visit', () => {
        expect(validateVisitCompletion(visit, voice)).toEqual({ ok: true, value: voice.id });
        expectError(validateVisitCompletion(visit, null), 'VOICE_REQUIRED');
        expectError(validateVisitCompletion(visit, { ...voice, visitId: 'previous-visit' }), 'RELATION_MISMATCH');
    });

    it.each([
        { state: 'draft' as const }, { submittedAt: null }, { submittedAt: 'not-a-time' }, { submittedByCustomer: false },
    ])('requires customer submission (%j)', change => {
        expectError(validateVisitCompletion(visit, { ...voice, ...change }), 'VOICE_NOT_SUBMITTED');
    });

    it.each([
        { validatedAt: null }, { validatedAt: 'invalid' }, { requiredAnswersValid: false }, { formVersion: ' ' },
    ])('requires successful form-version validation (%j)', change => {
        expectError(validateVisitCompletion(visit, { ...voice, ...change }), 'VOICE_NOT_VALIDATED');
    });

    it('cannot use questionnaire submission to reopen a cancelled/completed Visit', () => {
        expectError(validateVisitCompletion({ ...visit, status: 'cancelled' }, voice), 'VISIT_NOT_OPEN');
        expectError(validateVisitCompletion({ ...visit, status: 'completed' }, voice), 'VISIT_NOT_OPEN');
    });

    it('allows Visit completion while SOP remains incomplete without changing sale state', () => {
        expect(validateVisitCompletion(visit, voice).ok).toBe(true);
        expectError(validateChecklistCompletion([{ itemKey: 'close-house', result: 'pending', reason: '' }], ['close-house']), 'CHECKLIST_INCOMPLETE');
        expect(sale.stage).toBe('booked');
        expect(visit.status).toBe('awaiting_voice');
    });
});

describe('Checklist reasons and completeness', () => {
    it.each(['skipped', 'not_applicable', 'done'] as const)('requires a reason for %s (standard reasons may be used)', result => {
        expectError(validateChecklistItem({ itemKey: 'item-a', result, reason: ' ' }), 'REASON_REQUIRED');
        expect(validateChecklistItem({ itemKey: 'item-a', result, reason }).ok).toBe(true);
    });

    it('accepts skipped/NA items with reasons, not missing or duplicated required items', () => {
        const items = [
            { itemKey: 'a', result: 'done' as const, reason },
            { itemKey: 'b', result: 'not_applicable' as const, reason: 'บ้านไม่มีระบบนี้' },
            { itemKey: 'c', result: 'skipped' as const, reason: 'รอช่างและนัดตรวจซ้ำ' },
        ];
        expect(validateChecklistCompletion(items, ['a', 'b', 'c'])).toEqual({ ok: true, value: true });
        expectError(validateChecklistCompletion(items, ['a', 'b', 'c', 'd']), 'CHECKLIST_INCOMPLETE');
        expectError(validateChecklistCompletion([...items, items[0]], ['a']), 'DUPLICATE_CHECKLIST_ITEM');
        expectError(validateChecklistCompletion([], []), 'CHECKLIST_INCOMPLETE');
        expectError(validateChecklistCompletion(items, ['a', 'a']), 'CHECKLIST_INCOMPLETE');
    });

    it('normalizes a reason but refuses an empty one', () => {
        expect(validateReason('  ลูกค้าขอเลื่อน  ')).toEqual({ ok: true, value: 'ลูกค้าขอเลื่อน' });
        expectError(validateReason(null), 'REASON_REQUIRED');
    });
});
