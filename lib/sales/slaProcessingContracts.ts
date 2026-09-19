/** Command and minimal receipt only. No browser-supplied clock, calendar, owner,
 * completion proof or preview result can authorize processing. SQL recalculates
 * under locks. A receipt is historical, NOT a claim about current task state. */
import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';

export const SLA_PROCESSING_CONTRACT_VERSION = 'first_contact_processing_v1' as const;
export const SLA_PROCESSING_MAX_BODY_BYTES = 4096;
export const SLA_PROCESSING_HELD_REASONS = [
    'SCOPE_CLOSED', 'LEGACY_REVIEW', 'OWNER_NOT_READY', 'OWNER_REVIEW', 'MISSING_CREATION_EVIDENCE',
    'CONTACT_REVIEW', 'CUSTOMER_POSTPONEMENT', 'EXCEPTION_REVIEW', 'POLICY_REVIEW', 'SOURCE_TIME_REVIEW',
    'MISSING_CALENDAR', 'INVALID_CALENDAR', 'INSUFFICIENT_COVERAGE', 'STAFF_CALCULATION_REVIEW', 'REMINDER_REVIEW',
] as const;
export type SlaProcessingHeldReason = typeof SLA_PROCESSING_HELD_REASONS[number];
export type SlaProcessingReason = SlaProcessingHeldReason | 'NOT_DUE_YET' | 'OUTSIDE_WORKING_HOURS'
    | 'DUE_SOON' | 'OVERDUE' | 'WITHDRAWN_NOTIFICATION' | 'CONTACT_PROVEN' | 'TASK_CLOSED';
export interface SlaProcessingInput { requestId: string; taskId: string }
export interface SlaProcessingResult {
    actor: { userId: string; role: 'admin' };
    requestId: string; taskId: string; processedAt: string; replayed: boolean;
    outcome: 'held' | 'scheduled' | 'notified' | 'already_notified' | 'suppressed' | 'completed' | 'closed';
    reason: SlaProcessingReason; serviceDueAt: string; staffDueAt: string | null;
    notificationId: string | null; notificationType: 'due_soon' | 'overdue' | null;
    completedByActivityId: string | null; completedAt: string | null; withdrawnCount: number;
}
export class SlaProcessingInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor() { super('คำขอประมวลผล SLA ไม่ถูกต้อง'); }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const minTime = parseEvidenceTimestamp('0001-01-01T00:00:00Z')!;
const maxTime = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
function time(value: unknown): value is string {
    const parsed = parseEvidenceTimestamp(value);
    return typeof value === 'string' && !/[^0-9TZ:+.-]/u.test(value) && parsed !== null && parsed >= minTime && parsed <= maxTime;
}

export function parseSlaProcessingInput(value: unknown): SlaProcessingInput {
    if (!record(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'requestId') || !Object.hasOwn(value, 'taskId')
        || !uuid(value.requestId) || !uuid(value.taskId)) throw new SlaProcessingInputError();
    return { requestId: value.requestId.toLowerCase(), taskId: value.taskId.toLowerCase() };
}

/** Strip private fields and bind receipt to the original actor AND exact command.
 * Malformed success must be treated as uncertain, never safe-to-reissue-as-new. */
export function parseSlaProcessingResult(value: unknown, command: SlaProcessingInput, actorId: string): SlaProcessingResult {
    const fail = (): never => { throw new Error('Invalid SLA processing receipt'); };
    const input = parseSlaProcessingInput(command);
    if (!record(value) || !record(value.actor) || !uuid(actorId) || !uuid(value.actor.userId)
        || value.actor.userId.toLowerCase() !== actorId.toLowerCase() || value.actor.role !== 'admin'
        || !uuid(value.requestId) || value.requestId.toLowerCase() !== input.requestId
        || !uuid(value.taskId) || value.taskId.toLowerCase() !== input.taskId || !time(value.processedAt)
        || !time(value.serviceDueAt) || typeof value.replayed !== 'boolean'
        || typeof value.withdrawnCount !== 'number' || !Number.isSafeInteger(value.withdrawnCount)
        || value.withdrawnCount < 0 || value.withdrawnCount > 2147483647
        || !['held', 'scheduled', 'notified', 'already_notified', 'suppressed', 'completed', 'closed'].includes(value.outcome as string)
        || (value.staffDueAt !== null && !time(value.staffDueAt))
        || (value.notificationId !== null && !uuid(value.notificationId))
        || (value.completedByActivityId !== null && !uuid(value.completedByActivityId))
        || (value.completedAt !== null && !time(value.completedAt))) return fail();
    const { outcome, reason } = value;
    if (outcome === 'held' && !SLA_PROCESSING_HELD_REASONS.includes(reason as SlaProcessingHeldReason)) return fail();
    if (outcome === 'closed' && reason !== 'TASK_CLOSED') return fail();
    if (outcome === 'completed') {
        if (reason !== 'CONTACT_PROVEN' || value.completedByActivityId === null || value.completedAt === null
            || parseEvidenceTimestamp(value.completedAt)! > parseEvidenceTimestamp(value.processedAt)!) return fail();
    } else if (value.completedByActivityId !== null || value.completedAt !== null) return fail();
    if (['held', 'closed', 'completed'].includes(outcome as string)) {
        if (value.staffDueAt !== null) return fail();
    } else if (value.staffDueAt === null) return fail();
    if (outcome === 'scheduled' && !['NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS'].includes(reason as string)) return fail();
    if (outcome === 'suppressed' && reason !== 'WITHDRAWN_NOTIFICATION') return fail();
    if (outcome === 'notified' || outcome === 'already_notified') {
        if (value.notificationId === null || !['due_soon', 'overdue'].includes(value.notificationType as string)) return fail();
        const dueSoon = value.notificationType === 'due_soon';
        if (reason !== (dueSoon ? 'DUE_SOON' : 'OVERDUE')
            || (dueSoon ? parseEvidenceTimestamp(value.processedAt)! > parseEvidenceTimestamp(value.staffDueAt)!
                : parseEvidenceTimestamp(value.processedAt)! <= parseEvidenceTimestamp(value.staffDueAt)!)) return fail();
    } else if (value.notificationId !== null || value.notificationType !== null) return fail();
    return {
        actor: { userId: value.actor.userId.toLowerCase(), role: 'admin' }, requestId: input.requestId, taskId: input.taskId,
        processedAt: value.processedAt, replayed: value.replayed, outcome: outcome as SlaProcessingResult['outcome'],
        reason: reason as SlaProcessingReason, serviceDueAt: value.serviceDueAt, staffDueAt: value.staffDueAt as string | null,
        notificationId: typeof value.notificationId === 'string' ? value.notificationId.toLowerCase() : null,
        notificationType: value.notificationType as SlaProcessingResult['notificationType'],
        completedByActivityId: typeof value.completedByActivityId === 'string' ? value.completedByActivityId.toLowerCase() : null,
        completedAt: value.completedAt as string | null, withdrawnCount: value.withdrawnCount,
    };
}
