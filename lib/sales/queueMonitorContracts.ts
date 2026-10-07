import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';

export const QUEUE_MONITOR_CONTRACT_VERSION = 'first_contact_queue_monitor_v1' as const;
export interface QueueCycleSummary {
    startedAt: string; finishedAt: string; processedCount: number; sweepFinished: boolean;
    heldCount: number; notifiedCount: number;
}
export interface QueueDispatchRequest {
    requestId: string; attemptId: string; attemptCount: number;
    status: 'reserved' | 'retry_wait' | 'review' | 'completed';
    policyVersion: 'completion_spacing_v1' | 'bounded_burst_v2';
    createdAt: string; preparedAt: string; nextAttemptAt: string; completedAt: string | null;
    lastErrorCode: 'TRANSIENT_RETRY' | 'RETRY_LIMIT' | 'PROCESSING_REVIEW' | null;
    receipt: QueueCycleSummary | null;
}
export interface QueueMonitorSnapshot {
    contractVersion: typeof QUEUE_MONITOR_CONTRACT_VERSION;
    actor: { userId: string; role: 'admin' }; asOf: string; readOnly: true;
    targetSeconds: 300; deliveryLatencySeconds: null; sweepAgeSeconds: null;
    gates: { processing: boolean; cycle: boolean; worker: boolean; dispatcher: boolean; burst: boolean };
    candidates: { sampleCount: number; exact: boolean; scanLimit: 901; storedHeldCount: number; withoutStoredReviewCount: number };
    cursor: { afterCreatedAt: string | null; afterTaskId: string | null };
    currentRequest: QueueDispatchRequest | null;
}
export class QueueMonitorInputError extends Error {
    constructor() { super('หน้าตรวจคิวไม่รับตัวกรองหรือคำสั่งประมวลผล'); this.name = 'QueueMonitorInputError'; }
}
export class QueueMonitorProjectionError extends Error {
    constructor() { super('ข้อมูลตรวจคิวไม่ตรงรูปแบบหรือบัญชีที่ร้องขอ'); this.name = 'QueueMonitorProjectionError'; }
}
const bad = (): never => { throw new QueueMonitorProjectionError(); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const uuid = (value: unknown): string => isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad();
const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : bad();
const count = (value: unknown, max: number): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max && !Object.is(value, -0) ? value : bad();
const instant = (value: string): bigint => parseEvidenceTimestamp(value)!;
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return bad();
    const parsed = parseEvidenceTimestamp(value);
    return parsed !== null && parsed >= instant('0001-01-01T00:00:00Z') && parsed <= instant('9999-12-31T23:59:59.999999Z') ? value : bad();
}
export function parseQueueMonitorQuery(url: string): void {
    try { if ([...new URL(url).searchParams.keys()].length) throw new QueueMonitorInputError(); }
    catch { throw new QueueMonitorInputError(); }
}
function receipt(value: unknown, preparedAt: string, completedAt: string | null, asOf: string): QueueCycleSummary {
    const row = record(value);
    const result = { startedAt: timestamp(row.startedAt), finishedAt: timestamp(row.finishedAt),
        processedCount: count(row.processedCount, 10), sweepFinished: boolean(row.sweepFinished),
        heldCount: count(row.heldCount, 10), notifiedCount: count(row.notifiedCount, 10) };
    if (instant(result.startedAt) < instant(preparedAt) || instant(result.finishedAt) < instant(result.startedAt)
        || instant(result.finishedAt) > instant(asOf) || completedAt === null || instant(result.finishedAt) > instant(completedAt)
        || result.heldCount + result.notifiedCount > result.processedCount) return bad();
    return result;
}
function dispatch(value: unknown, asOf: string): QueueDispatchRequest {
    const row = record(value);
    if (typeof row.status !== 'string' || !['reserved', 'retry_wait', 'review', 'completed'].includes(row.status)
        || typeof row.policyVersion !== 'string' || !['completion_spacing_v1', 'bounded_burst_v2'].includes(row.policyVersion)
        || (row.lastErrorCode !== null && (typeof row.lastErrorCode !== 'string' || !['TRANSIENT_RETRY', 'RETRY_LIMIT', 'PROCESSING_REVIEW'].includes(row.lastErrorCode)))) return bad();
    const result: QueueDispatchRequest = {
        requestId: uuid(row.requestId), attemptId: uuid(row.attemptId), attemptCount: count(row.attemptCount, 5),
        status: row.status as QueueDispatchRequest['status'], policyVersion: row.policyVersion as QueueDispatchRequest['policyVersion'],
        createdAt: timestamp(row.createdAt), preparedAt: timestamp(row.preparedAt), nextAttemptAt: timestamp(row.nextAttemptAt),
        completedAt: row.completedAt === null ? null : timestamp(row.completedAt), lastErrorCode: row.lastErrorCode as QueueDispatchRequest['lastErrorCode'], receipt: null,
    };
    if (result.attemptCount < 1 || instant(result.createdAt) > instant(result.preparedAt) || instant(result.preparedAt) > instant(asOf)
        || instant(result.nextAttemptAt) < instant(result.createdAt) || (result.status === 'completed') !== (result.completedAt !== null)) return bad();
    if (result.completedAt !== null && (instant(result.completedAt) < instant(result.preparedAt) || instant(result.completedAt) > instant(asOf))) return bad();
    if (result.status === 'review' && !['RETRY_LIMIT', 'PROCESSING_REVIEW'].includes(result.lastErrorCode ?? '')) return bad();
    if (result.status === 'retry_wait' && result.lastErrorCode !== 'TRANSIENT_RETRY') return bad();
    if ((result.status === 'completed' || result.status === 'reserved') && result.lastErrorCode !== null) return bad();
    if ((result.status === 'completed') !== (row.receipt !== null)) return bad();
    result.receipt = row.receipt === null ? null : receipt(row.receipt, result.preparedAt, result.completedAt, asOf);
    return result;
}
/** Whitelist both server and browser responses. No raw receipt/evaluation/error,
 * customer details or future operational commands may escape this projection. */
export function parseQueueMonitorSnapshot(value: unknown, expectedActorId?: string): QueueMonitorSnapshot {
    try {
        const row = record(value), actor = record(row.actor), gates = record(row.gates), candidates = record(row.candidates), cursor = record(row.cursor);
        const userId = uuid(actor.userId), asOf = timestamp(row.asOf);
        if (actor.role !== 'admin' || (expectedActorId !== undefined && userId !== uuid(expectedActorId))
            || row.contractVersion !== QUEUE_MONITOR_CONTRACT_VERSION || row.readOnly !== true || row.targetSeconds !== 300
            || row.deliveryLatencySeconds !== null || row.sweepAgeSeconds !== null || candidates.scanLimit !== 901) return bad();
        const sampled = { sampleCount: count(candidates.sampleCount, 901), exact: boolean(candidates.exact), scanLimit: 901 as const,
            storedHeldCount: count(candidates.storedHeldCount, 901), withoutStoredReviewCount: count(candidates.withoutStoredReviewCount, 901) };
        if (sampled.exact !== (sampled.sampleCount < 901) || sampled.storedHeldCount + sampled.withoutStoredReviewCount > sampled.sampleCount) return bad();
        const position = { afterCreatedAt: cursor.afterCreatedAt === null ? null : timestamp(cursor.afterCreatedAt), afterTaskId: cursor.afterTaskId === null ? null : uuid(cursor.afterTaskId) };
        if ((position.afterCreatedAt === null) !== (position.afterTaskId === null)) return bad();
        return { contractVersion: QUEUE_MONITOR_CONTRACT_VERSION, actor: { userId, role: 'admin' }, asOf, readOnly: true,
            targetSeconds: 300, deliveryLatencySeconds: null, sweepAgeSeconds: null,
            gates: { processing: boolean(gates.processing), cycle: boolean(gates.cycle), worker: boolean(gates.worker), dispatcher: boolean(gates.dispatcher), burst: boolean(gates.burst) },
            candidates: sampled, cursor: position, currentRequest: row.currentRequest === null ? null : dispatch(row.currentRequest, asOf) };
    } catch { throw new QueueMonitorProjectionError(); }
}

export type QueueMonitorWarning = 'WRITERS_DISABLED' | 'BURST_DISABLED' | 'REVIEW_REQUIRED' | 'RESERVATION_ELAPSED'
    | 'RETRY_WAIT' | 'ATTEMPT_LIMIT' | 'REQUEST_AGE_TARGET' | 'CANDIDATES_TRUNCATED' | 'STORED_HELD' | 'MISSING_STORED_REVIEW' | 'LATENCY_UNMEASURED';
/** Server-snapshot time only; none of these observations authorizes recovery. */
export function queueMonitorWarnings(snapshot: QueueMonitorSnapshot): QueueMonitorWarning[] {
    const result: QueueMonitorWarning[] = [], request = snapshot.currentRequest;
    if (!snapshot.gates.processing || !snapshot.gates.cycle || !snapshot.gates.worker || !snapshot.gates.dispatcher) result.push('WRITERS_DISABLED');
    if (!snapshot.gates.burst) result.push('BURST_DISABLED');
    if (request && request.status !== 'completed') {
        if (request.status === 'review') result.push('REVIEW_REQUIRED');
        if (request.status === 'reserved' && instant(request.nextAttemptAt) <= instant(snapshot.asOf)) result.push('RESERVATION_ELAPSED');
        if (request.status === 'retry_wait') result.push('RETRY_WAIT');
        if (request.attemptCount === 5) result.push('ATTEMPT_LIMIT');
        if (instant(snapshot.asOf) - instant(request.createdAt) >= BigInt(300_000_000)) result.push('REQUEST_AGE_TARGET');
    }
    if (!snapshot.candidates.exact) result.push('CANDIDATES_TRUNCATED');
    if (snapshot.candidates.storedHeldCount > 0) result.push('STORED_HELD');
    if (snapshot.candidates.withoutStoredReviewCount > 0) result.push('MISSING_STORED_REVIEW');
    result.push('LATENCY_UNMEASURED');
    return result;
}
