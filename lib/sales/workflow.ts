/**
 * Sales V2 domain rules, deliberately independent of the legacy tables and UI.
 *
 * These pure functions do not authorize a database write. A future server command
 * must obtain actor/ownership/evidence from trusted storage, validate input, lock
 * affected records, and persist the change plus its audit event atomically. Never
 * trust a role, owner, validation flag, or loan history supplied by the browser.
 */

export const CUSTOMER_STATUSES = ['new', 'contacted', 'following_up', 'nurture', 'lost'] as const;
export const INTEREST_STATUSES = ['new', 'contacted', 'considering', 'follow_up', 'nurture', 'lost'] as const;
export const SALE_STAGES = [
    'booked', 'contracted', 'downpayment', 'document_prep', 'loan_submitted',
    'loan_rejected', 'loan_approved', 'transfer_pending', 'transferred', 'handover', 'cancelled',
] as const;

export type CustomerStatus = typeof CUSTOMER_STATUSES[number];
export type InterestStatus = typeof INTEREST_STATUSES[number];
export type SaleStage = typeof SALE_STAGES[number];
export type CrmRole = 'sales' | 'admin' | 'owner';
export type PaymentMethod = 'cash' | 'mortgage';
export type VisitStatus = 'awaiting_voice' | 'completed' | 'cancelled';
export type ChecklistResult = 'pending' | 'done' | 'not_applicable' | 'skipped';

export interface CrmActor {
    readonly userId: string;
    readonly role: CrmRole;
    readonly active: boolean;
}

export interface CentralCustomer {
    readonly id: string;
    readonly ownerUserId: string;
    readonly intakeStatus: CustomerStatus;
}

export interface ProjectInterest {
    readonly id: string;
    readonly customerId: string;
    readonly projectName: string;
    readonly ownerUserId: string;
    readonly workspaceState: 'central_interest' | 'project_active';
    readonly engagementStatus: InterestStatus;
}

export interface SaleRecord {
    readonly id: string;
    readonly interestId: string;
    readonly plotId: string;
    readonly stage: SaleStage;
    readonly paymentMethod: PaymentMethod;
}

export type WorkflowErrorCode =
    | 'FORBIDDEN' | 'REASON_REQUIRED' | 'NAME_REQUIRED' | 'PHONE_REQUIRED'
    | 'SALES_OWNER_REQUIRED' | 'RELATION_MISMATCH' | 'INVALID_STATUS'
    | 'UNCHANGED_STATUS' | 'BOOKING_HISTORY_EXISTS' | 'ILLEGAL_TRANSITION'
    | 'CASH_LOAN_NOT_ALLOWED' | 'LOAN_REQUIRED' | 'NEW_LOAN_ATTEMPT_REQUIRED'
    | 'DUPLICATE_LOAN_ATTEMPT' | 'INVALID_LOAN_ATTEMPT'
    | 'VISIT_NOT_OPEN' | 'VOICE_REQUIRED' | 'VOICE_NOT_SUBMITTED' | 'VOICE_NOT_VALIDATED'
    | 'CHECKLIST_INCOMPLETE' | 'DUPLICATE_CHECKLIST_ITEM';

export type WorkflowResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly code: WorkflowErrorCode; readonly message: string };

const success = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });
const failure = (code: WorkflowErrorCode, message: string): WorkflowResult<never> => ({ ok: false, code, message });
const nonBlank = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0;

export function validateReason(reason: string | null | undefined): WorkflowResult<string> {
    return nonBlank(reason)
        ? success(reason.trim())
        : failure('REASON_REQUIRED', 'กรุณาระบุเหตุผลในการทำรายการ');
}

export function canReadCrm(actor: CrmActor): boolean {
    return actor.active && nonBlank(actor.userId) && ['sales', 'admin', 'owner'].includes(actor.role);
}

function canEditOwnedRecord(actor: CrmActor, ownerUserId: string): boolean {
    return canReadCrm(actor) && (actor.role === 'admin' || (actor.role === 'sales' && actor.userId === ownerUserId));
}

export function canEditCustomer(actor: CrmActor, customer: CentralCustomer): boolean {
    return canEditOwnedRecord(actor, customer.ownerUserId);
}

export function canEditInterest(actor: CrmActor, interest: ProjectInterest): boolean {
    return canEditOwnedRecord(actor, interest.ownerUserId);
}

/** Project selection is intentionally absent: central intake must work without it. */
export function validateCustomerIntake(input: { name: string; phone: string }): WorkflowResult<{ name: string; phone: string }> {
    if (!nonBlank(input.name)) return failure('NAME_REQUIRED', 'กรุณาระบุชื่อลูกค้า');
    if (!nonBlank(input.phone) || !/\d/.test(input.phone)) return failure('PHONE_REQUIRED', 'กรุณาระบุเบอร์โทรลูกค้า');
    return success({ name: input.name.trim(), phone: input.phone.trim() });
}

/** Creation only; never use this to overwrite ownership of an existing customer. */
export function resolveNewCustomerOwner(actor: CrmActor, assignedSales?: CrmActor): WorkflowResult<string> {
    if (!canReadCrm(actor) || actor.role === 'owner') return failure('FORBIDDEN', 'ไม่มีสิทธิ์สร้าง Lead');
    if (actor.role === 'sales') {
        if (assignedSales && assignedSales.userId !== actor.userId) return failure('FORBIDDEN', 'Sales ผู้บันทึกต้องเป็นผู้ดูแล Lead ใหม่');
        return success(actor.userId);
    }
    if (!assignedSales || !assignedSales.active || assignedSales.role !== 'sales' || !nonBlank(assignedSales.userId)) {
        return failure('SALES_OWNER_REQUIRED', 'Admin ต้องเลือกผู้ดูแลที่เป็น Sales และยังใช้งานอยู่');
    }
    return success(assignedSales.userId);
}

export function validateOwnerAssignment(actor: CrmActor, newOwner: CrmActor, reason: string): WorkflowResult<string> {
    if (!canReadCrm(actor) || actor.role !== 'admin') return failure('FORBIDDEN', 'Admin เท่านั้นที่เปลี่ยนผู้ดูแลได้');
    const reasonResult = validateReason(reason);
    if (!reasonResult.ok) return reasonResult;
    if (!newOwner.active || newOwner.role !== 'sales' || !nonBlank(newOwner.userId)) {
        return failure('SALES_OWNER_REQUIRED', 'ผู้ดูแลใหม่ต้องเป็น Sales ที่ยังใช้งานอยู่');
    }
    return success(newOwner.userId);
}

export function validateInterestStatusChange(
    actor: CrmActor,
    interest: ProjectInterest,
    nextStatus: InterestStatus,
    reason: string,
    bookingHistory: readonly SaleRecord[],
): WorkflowResult<InterestStatus> {
    if (!canEditInterest(actor, interest)) return failure('FORBIDDEN', 'เฉพาะ Sales เจ้าของงานหรือ Admin ที่แก้ไขได้');
    const reasonResult = validateReason(reason);
    if (!reasonResult.ok) return reasonResult;
    if (!INTEREST_STATUSES.includes(nextStatus)) return failure('INVALID_STATUS', 'สถานะความสนใจไม่ถูกต้อง');
    if (nextStatus === interest.engagementStatus) return failure('UNCHANGED_STATUS', 'สถานะไม่ได้เปลี่ยนแปลง');
    if (nextStatus === 'lost' && bookingHistory.some(sale => sale.interestId === interest.id)) {
        return failure('BOOKING_HISTORY_EXISTS', 'รายการที่เคยจองต้องบันทึกผลที่รายการขาย ไม่ใช้ Lost ก่อนจอง');
    }
    return success(nextStatus);
}

/** Returns only the affected interest; other projects and the customer remain unchanged. */
export function activateProjectInterest(
    actor: CrmActor,
    interest: ProjectInterest,
    event: 'visit' | 'booking',
    reason: string,
): WorkflowResult<ProjectInterest> {
    if (!canEditInterest(actor, interest)) return failure('FORBIDDEN', 'ไม่มีสิทธิ์เปิดงานของโครงการนี้');
    const reasonResult = validateReason(reason);
    if (!reasonResult.ok) return reasonResult;
    if (event !== 'visit' && event !== 'booking') return failure('INVALID_STATUS', 'เปิดงานโครงการได้เมื่อเข้าชมหรือจองเท่านั้น');
    return success({ ...interest, workspaceState: 'project_active' });
}

export interface LoanAttempt {
    readonly id: string;
    readonly saleId: string;
    readonly attemptNumber: number;
    readonly status: 'submitted' | 'rejected' | 'approved' | 'withdrawn';
}

/** Creates a new history array; it cannot overwrite the rejected application. */
export function appendLoanAttempt(
    sale: SaleRecord,
    history: readonly LoanAttempt[],
    next: LoanAttempt,
): WorkflowResult<readonly LoanAttempt[]> {
    if (sale.paymentMethod === 'cash') return failure('CASH_LOAN_NOT_ALLOWED', 'รายการเงินสดไม่ต้องสร้างสินเชื่อ');
    if (sale.stage !== 'document_prep' && sale.stage !== 'loan_rejected') {
        return failure('ILLEGAL_TRANSITION', 'ยังไม่อยู่ในขั้นที่ยื่นสินเชื่อครั้งใหม่ได้');
    }
    if (next.saleId !== sale.id) return failure('RELATION_MISMATCH', 'สินเชื่อไม่ตรงกับรายการขาย');
    if (history.some(attempt => attempt.id === next.id || (attempt.saleId === sale.id && attempt.attemptNumber === next.attemptNumber))) {
        return failure('DUPLICATE_LOAN_ATTEMPT', 'ต้องสร้างรหัสและลำดับการยื่นใหม่ ไม่ทับครั้งก่อน');
    }
    const previous = history.filter(attempt => attempt.saleId === sale.id);
    const expectedNumber = Math.max(0, ...previous.map(attempt => attempt.attemptNumber)) + 1;
    if (!nonBlank(next.id) || !Number.isInteger(next.attemptNumber) || next.attemptNumber !== expectedNumber || next.status !== 'submitted') {
        return failure('INVALID_LOAN_ATTEMPT', 'การยื่นใหม่ต้องเป็น submitted และใช้ลำดับถัดไป');
    }
    if (sale.stage === 'loan_rejected' && !previous.some(attempt => attempt.status === 'rejected')) {
        return failure('INVALID_LOAN_ATTEMPT', 'ต้องมีประวัติการปฏิเสธเดิมก่อนยื่นใหม่');
    }
    return success([...history, { ...next }]);
}

const NEXT_SALE_STAGES: Readonly<Record<SaleStage, readonly SaleStage[]>> = {
    booked: ['contracted', 'cancelled'],
    contracted: ['downpayment', 'document_prep', 'transfer_pending', 'cancelled'],
    downpayment: ['document_prep', 'transfer_pending', 'cancelled'],
    document_prep: ['loan_submitted', 'transfer_pending', 'cancelled'],
    loan_submitted: ['loan_rejected', 'loan_approved', 'cancelled'],
    loan_rejected: ['loan_submitted', 'cancelled'],
    loan_approved: ['transfer_pending', 'cancelled'],
    transfer_pending: ['transferred', 'cancelled'],
    transferred: ['handover'],
    handover: [],
    cancelled: [],
};

export interface SaleTransitionInput {
    readonly actor: CrmActor;
    readonly interest: ProjectInterest;
    readonly sale: SaleRecord;
    readonly nextStage: SaleStage;
    readonly reason: string;
    readonly loanHistory?: readonly LoanAttempt[];
    readonly newLoanAttempt?: LoanAttempt;
}

/** Validates the stage path only, not payment evidence, plot locks, or transfer documents. */
export function validateSaleTransition(input: SaleTransitionInput): WorkflowResult<SaleStage> {
    const { actor, interest, sale, nextStage, reason } = input;
    if (sale.interestId !== interest.id) return failure('RELATION_MISMATCH', 'รายการขายไม่ตรงกับความสนใจโครงการ');
    if (!canEditInterest(actor, interest)) return failure('FORBIDDEN', 'เฉพาะ Sales เจ้าของงานหรือ Admin ที่เปลี่ยนสถานะได้');
    const reasonResult = validateReason(reason);
    if (!reasonResult.ok) return reasonResult;
    if (!SALE_STAGES.includes(sale.stage) || !SALE_STAGES.includes(nextStage)) return failure('INVALID_STATUS', 'สถานะการขายไม่ถูกต้อง');
    if (sale.stage === nextStage) return failure('UNCHANGED_STATUS', 'สถานะไม่ได้เปลี่ยนแปลง');
    if (!NEXT_SALE_STAGES[sale.stage].includes(nextStage)) {
        return failure('ILLEGAL_TRANSITION', 'ไม่สามารถเปลี่ยนสถานะตามเส้นทางนี้ได้; หลังโอนห้ามยกเลิกจองตามปกติ');
    }
    if (sale.paymentMethod === 'cash' && (sale.stage.startsWith('loan_') || nextStage.startsWith('loan_'))) {
        return failure('CASH_LOAN_NOT_ALLOWED', 'รายการเงินสดต้องข้ามสินเชื่อ ไม่สร้างผลกู้ปลอม');
    }
    if (nextStage === 'transfer_pending' && sale.paymentMethod === 'mortgage' && sale.stage !== 'loan_approved') {
        return failure('LOAN_REQUIRED', 'รายการกู้ต้องผ่านอนุมัติสินเชื่อก่อนรอโอน');
    }
    if (nextStage === 'loan_submitted') {
        if (!input.newLoanAttempt) return failure('NEW_LOAN_ATTEMPT_REQUIRED', 'ต้องบันทึกการยื่นสินเชื่อเป็นครั้งใหม่');
        const attemptResult = appendLoanAttempt(sale, input.loanHistory ?? [], input.newLoanAttempt);
        if (!attemptResult.ok) return attemptResult;
    }
    return success(nextStage);
}

export interface VisitRecord {
    readonly id: string;
    readonly interestId: string;
    readonly status: VisitStatus;
}

/** Evidence must come from server-side questionnaire validation, never a client flag. */
export interface VoiceSubmissionEvidence {
    readonly id: string;
    readonly visitId: string;
    readonly state: 'draft' | 'submitted';
    readonly formVersion: string;
    readonly submittedAt: string | null;
    readonly validatedAt: string | null;
    readonly submittedByCustomer: boolean;
    readonly requiredAnswersValid: boolean;
}

function isTimestamp(value: string | null): boolean {
    return nonBlank(value) && Number.isFinite(Date.parse(value));
}

/** Checklist completion is deliberately not an input or a prerequisite here. */
export function validateVisitCompletion(visit: VisitRecord, voice: VoiceSubmissionEvidence | null): WorkflowResult<string> {
    if (visit.status !== 'awaiting_voice') return failure('VISIT_NOT_OPEN', 'Visit นี้ไม่ได้รอแบบสอบถาม');
    if (!voice || !nonBlank(voice.id)) return failure('VOICE_REQUIRED', 'ต้องมี Customer Voices ของ Visit นี้');
    if (voice.visitId !== visit.id) return failure('RELATION_MISMATCH', 'Customer Voices เป็นของ Visit คนละครั้ง');
    if (voice.state !== 'submitted' || !isTimestamp(voice.submittedAt) || !voice.submittedByCustomer) {
        return failure('VOICE_NOT_SUBMITTED', 'ลูกค้าต้องส่ง Customer Voices ก่อนจบ Visit');
    }
    if (!nonBlank(voice.formVersion) || !isTimestamp(voice.validatedAt) || !voice.requiredAnswersValid) {
        return failure('VOICE_NOT_VALIDATED', 'คำตอบจำเป็นต้องผ่านการตรวจตามรุ่นแบบสอบถาม');
    }
    return success(voice.id);
}

export interface ChecklistItem {
    readonly itemKey: string;
    readonly result: ChecklistResult;
    readonly reason: string;
}

export function validateChecklistItem(item: ChecklistItem): WorkflowResult<ChecklistItem> {
    if (!nonBlank(item.itemKey) || !['pending', 'done', 'not_applicable', 'skipped'].includes(item.result)) {
        return failure('INVALID_STATUS', 'รายการ Checklist ไม่ถูกต้อง');
    }
    if (item.result !== 'pending') {
        const reasonResult = validateReason(item.reason);
        if (!reasonResult.ok) return reasonResult;
    }
    return success({ ...item, reason: item.reason.trim() });
}

/** Required keys come from the saved template version; an empty list cannot complete a run. */
export function validateChecklistCompletion(items: readonly ChecklistItem[], requiredKeys: readonly string[]): WorkflowResult<true> {
    if (new Set(items.map(item => item.itemKey)).size !== items.length) {
        return failure('DUPLICATE_CHECKLIST_ITEM', 'มีข้อ Checklist ซ้ำกัน');
    }
    if (!requiredKeys.length || requiredKeys.some(key => !nonBlank(key)) || new Set(requiredKeys).size !== requiredKeys.length) {
        return failure('CHECKLIST_INCOMPLETE', 'ต้องมีรายการข้อจากรุ่น Checklist ที่ถูกต้อง');
    }
    for (const item of items) {
        const itemResult = validateChecklistItem(item);
        if (!itemResult.ok) return itemResult;
    }
    if (requiredKeys.some(key => !items.some(item => item.itemKey === key && item.result !== 'pending'))) {
        return failure('CHECKLIST_INCOMPLETE', 'ยังตอบ Checklist ไม่ครบทุกข้อ');
    }
    return success(true);
}
