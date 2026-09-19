import { isCentralUuid } from './centralContracts';
import { parseSlaProcessingInput, parseSlaProcessingResult, type SlaProcessingInput, type SlaProcessingResult } from './slaProcessingContracts';

export const SLA_RECEIPT_CONTRACT_VERSION = 'first_contact_receipt_review_v1' as const;
export interface SlaReceiptContext {
    actor: { userId: string; role: 'admin' };
    processingEnabled: boolean;
}
export interface SlaReceiptLookup {
    actor: { userId: string; role: 'admin' };
    requestId: string;
    taskId: string;
    /** False is an observation of this read snapshot, NOT proof that a pending
     * or earlier uncertain command did not commit. Never discard a pending ID. */
    found: boolean;
    receipt: SlaProcessingResult | null;
}
export class SlaReceiptInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor() { super('ข้อมูลคำขอตรวจผล SLA ไม่ถูกต้อง'); this.name = 'SlaReceiptInputError'; }
}
export class SlaReceiptProjectionError extends Error {
    constructor() { super('ข้อมูลผล SLA ไม่ตรงกับบัญชีหรือคำขอที่ตรวจ'); this.name = 'SlaReceiptProjectionError'; }
}
const bad = (): never => { throw new SlaReceiptProjectionError(); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const uuid = (value: unknown): string => isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad();
function actor(value: unknown, expectedActorId?: string): SlaReceiptContext['actor'] {
    const row = record(value);
    if (row.role !== 'admin') return bad();
    const userId = uuid(row.userId);
    if (expectedActorId !== undefined && userId !== uuid(expectedActorId)) return bad();
    return { userId, role: 'admin' };
}
/** No query selects capability context. Lookup requires the exact two IDs only;
 * never accept an actor selector, clock, policy or processing instruction. */
export function parseSlaReceiptQuery(url: string): SlaProcessingInput | null {
    try {
        const params = new URL(url).searchParams;
        if (!Array.from(params.keys()).length) return null;
        if (Array.from(params.keys()).some(key => key !== 'requestId' && key !== 'taskId')
            || params.getAll('requestId').length !== 1 || params.getAll('taskId').length !== 1) throw new SlaReceiptInputError();
        return parseSlaProcessingInput({ requestId: params.get('requestId'), taskId: params.get('taskId') });
    } catch { throw new SlaReceiptInputError(); }
}
export function parseSlaReceiptContext(value: unknown, expectedActorId?: string): SlaReceiptContext {
    try {
        const row = record(value);
        if (typeof row.processingEnabled !== 'boolean') return bad();
        return { actor: actor(row.actor, expectedActorId), processingEnabled: row.processingEnabled };
    } catch { throw new SlaReceiptProjectionError(); }
}
/** Minimal historical receipt projection. Found=false and mismatched/not-visible
 * storage must never become permission to mint a new command/request identity. */
export function parseSlaReceiptLookup(value: unknown, input: SlaProcessingInput, expectedActorId: string): SlaReceiptLookup {
    try {
        const row = record(value), command = parseSlaProcessingInput(input), currentActor = actor(row.actor, expectedActorId);
        const requestId = uuid(row.requestId), taskId = uuid(row.taskId);
        if (requestId !== command.requestId || taskId !== command.taskId || typeof row.found !== 'boolean') return bad();
        if (!row.found && row.receipt !== null) return bad();
        const receipt = row.found ? parseSlaProcessingResult(row.receipt, command, currentActor.userId) : null;
        return { actor: currentActor, requestId, taskId, found: row.found, receipt };
    } catch { throw new SlaReceiptProjectionError(); }
}
