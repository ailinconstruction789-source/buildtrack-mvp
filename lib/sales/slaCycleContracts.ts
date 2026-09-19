/** Dormant bounded-cycle contract. Browser callers cannot choose tasks, cursor,
 * clock, policy, owner, limit, or child request IDs. A receipt is historical and
 * an absent receipt is never proof that an earlier command did not commit. */
import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { parseSlaProcessingResult, type SlaProcessingResult } from './slaProcessingContracts';

export const SLA_CYCLE_CONTRACT_VERSION = 'first_contact_cycle_v1' as const;
export const SLA_CYCLE_MAX_ITEMS = 10 as const;
export const SLA_CYCLE_MAX_BODY_BYTES = 4096;
export interface SlaCycleInput { requestId: string }
export interface SlaCycleContext {
    actor: { userId: string; role: 'admin' };
    processingEnabled: boolean;
    maxItems: 10;
}
export interface SlaCycleResult {
    actor: SlaCycleContext['actor']; requestId: string; startedAt: string; finishedAt: string;
    replayed: boolean; maxItems: 10; processedCount: number; sweepFinished: boolean;
    receipts: SlaProcessingResult[];
}
export interface SlaCycleLookup {
    actor: SlaCycleContext['actor']; requestId: string; found: boolean; receipt: SlaCycleResult | null;
}
export class SlaCycleInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor() { super('คำขอรอบประมวลผล SLA ไม่ถูกต้อง'); this.name = 'SlaCycleInputError'; }
}
export class SlaCycleProjectionError extends Error {
    constructor() { super('ข้อมูลรอบประมวลผล SLA ไม่ตรงกับบัญชีหรือคำขอ'); this.name = 'SlaCycleProjectionError'; }
}
const bad = (): never => { throw new SlaCycleProjectionError(); };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : bad();
const uuid = (value: unknown): string => isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad();
const minimum = parseEvidenceTimestamp('0001-01-01T00:00:00Z')!;
const maximum = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return bad();
    const parsed = parseEvidenceTimestamp(value);
    return parsed !== null && parsed >= minimum && parsed <= maximum ? value : bad();
}
function actor(value: unknown, expectedActorId: string): SlaCycleContext['actor'] {
    const row = record(value), userId = uuid(row.userId);
    if (row.role !== 'admin' || userId !== uuid(expectedActorId)) return bad();
    return { userId, role: 'admin' };
}

export function parseSlaCycleInput(value: unknown): SlaCycleInput {
    try {
        if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'requestId')) throw new SlaCycleInputError();
        return { requestId: uuid(value.requestId) };
    } catch { throw new SlaCycleInputError(); }
}
/** No parameters reads capability context. Exactly one requestId reads ONLY an
 * own-Admin historical receipt; it must never cause processing or cursor work. */
export function parseSlaCycleQuery(url: string): SlaCycleInput | null {
    try {
        const params = new URL(url).searchParams;
        if (!Array.from(params.keys()).length) return null;
        if (Array.from(params.keys()).some(key => key !== 'requestId') || params.getAll('requestId').length !== 1) throw new SlaCycleInputError();
        return parseSlaCycleInput({ requestId: params.get('requestId') });
    } catch { throw new SlaCycleInputError(); }
}
export function parseSlaCycleContext(value: unknown, expectedActorId: string): SlaCycleContext {
    try {
        const row = record(value);
        if (typeof row.processingEnabled !== 'boolean' || row.maxItems !== SLA_CYCLE_MAX_ITEMS) return bad();
        return { actor: actor(row.actor, expectedActorId), processingEnabled: row.processingEnabled, maxItems: SLA_CYCLE_MAX_ITEMS };
    } catch { throw new SlaCycleProjectionError(); }
}
/** Preserve exact historical instants. The trusted SQL selects child commands;
 * this parser binds every nested receipt to the same verified Admin, validates
 * each child through the existing single-task contract, and strips private data. */
export function parseSlaCycleResult(value: unknown, input: SlaCycleInput, expectedActorId: string): SlaCycleResult {
    try {
        const row = record(value), command = parseSlaCycleInput(input), currentActor = actor(row.actor, expectedActorId);
        const requestId = uuid(row.requestId), startedAt = timestamp(row.startedAt), finishedAt = timestamp(row.finishedAt);
        const started = parseEvidenceTimestamp(startedAt)!, finished = parseEvidenceTimestamp(finishedAt)!;
        if (requestId !== command.requestId || started > finished || typeof row.replayed !== 'boolean'
            || row.maxItems !== SLA_CYCLE_MAX_ITEMS || typeof row.processedCount !== 'number' || !Number.isInteger(row.processedCount)
            || Object.is(row.processedCount, -0) || row.processedCount < 0 || row.processedCount > SLA_CYCLE_MAX_ITEMS
            || typeof row.sweepFinished !== 'boolean' || !Array.isArray(row.receipts)
            || (row.processedCount < SLA_CYCLE_MAX_ITEMS && row.sweepFinished !== true)
            || row.receipts.length !== row.processedCount || row.receipts.length > SLA_CYCLE_MAX_ITEMS) return bad();
        const receipts = row.receipts.map(value => {
            const child = record(value);
            const result = parseSlaProcessingResult(child, { requestId: uuid(child.requestId), taskId: uuid(child.taskId) }, currentActor.userId);
            const processed = parseEvidenceTimestamp(result.processedAt)!;
            // Each atomic cycle allocates fresh child IDs. Replaying the parent
            // returns its original children, not a second replay of each child.
            if (result.replayed || processed < started || processed > finished) return bad();
            return result;
        });
        if (new Set(receipts.map(child => child.requestId)).size !== receipts.length
            || new Set(receipts.map(child => child.taskId)).size !== receipts.length) return bad();
        return { actor: currentActor, requestId, startedAt, finishedAt, replayed: row.replayed,
            maxItems: SLA_CYCLE_MAX_ITEMS, processedCount: row.processedCount, sweepFinished: row.sweepFinished, receipts };
    } catch { throw new SlaCycleProjectionError(); }
}
export function parseSlaCycleLookup(value: unknown, input: SlaCycleInput, expectedActorId: string): SlaCycleLookup {
    try {
        const row = record(value), command = parseSlaCycleInput(input), currentActor = actor(row.actor, expectedActorId);
        const requestId = uuid(row.requestId);
        if (requestId !== command.requestId || typeof row.found !== 'boolean' || (!row.found && row.receipt !== null)) return bad();
        return { actor: currentActor, requestId, found: row.found,
            receipt: row.found ? parseSlaCycleResult(row.receipt, command, currentActor.userId) : null };
    } catch { throw new SlaCycleProjectionError(); }
}
