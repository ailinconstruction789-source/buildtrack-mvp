import { describe, expect, it } from 'vitest';
import { parseQueueMonitorQuery, parseQueueMonitorSnapshot, queueMonitorWarnings, QUEUE_MONITOR_CONTRACT_VERSION, type QueueMonitorSnapshot } from '../queueMonitorContracts';

const admin = '00000000-0000-4000-8000-000000000001';
function fixture(): QueueMonitorSnapshot {
    return { contractVersion: QUEUE_MONITOR_CONTRACT_VERSION, actor: { userId: admin, role: 'admin' },
        asOf: '2026-09-23T08:05:00.000001Z', readOnly: true, targetSeconds: 300, deliveryLatencySeconds: null, sweepAgeSeconds: null,
        gates: { processing: true, cycle: true, worker: true, dispatcher: true, burst: true },
        candidates: { sampleCount: 3, scanLimit: 901, exact: true, storedHeldCount: 1, withoutStoredReviewCount: 1 },
        cursor: { afterCreatedAt: null, afterTaskId: null },
        currentRequest: { requestId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003',
            attemptCount: 1, status: 'reserved', policyVersion: 'bounded_burst_v2', createdAt: '2026-09-23T08:00:00.000001Z',
            preparedAt: '2026-09-23T08:00:00.000001Z', nextAttemptAt: '2026-09-23T08:01:00.000001Z', completedAt: null, lastErrorCode: null, receipt: null } };
}
function completed(): QueueMonitorSnapshot {
    const value = fixture();
    Object.assign(value.currentRequest!, { status: 'completed', completedAt: '2026-09-23T08:00:02Z', nextAttemptAt: '2026-09-23T08:01:02Z',
        receipt: { startedAt: '2026-09-23T08:00:01Z', finishedAt: '2026-09-23T08:00:02Z', processedCount: 3, sweepFinished: false, heldCount: 1, notifiedCount: 1 } });
    return value;
}
function setPath(value: unknown, path: string, next: unknown) {
    const parts = path.split('.'); let row = value as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) row = row[part] as Record<string, unknown>;
    row[parts.at(-1)!] = next;
}
describe('queue monitor read-only projection', () => {
    it('roundtrips a known projection and normalizes the actor', () => {
        expect(parseQueueMonitorSnapshot(fixture(), admin.toUpperCase())).toEqual(fixture());
        expect(parseQueueMonitorSnapshot(completed())).toEqual(completed());
    });
    it('explicitly preserves unknown latency rather than inferring it from old receipts', () => {
        const value = completed(); value.currentRequest!.policyVersion = 'completion_spacing_v1';
        expect(parseQueueMonitorSnapshot(value).deliveryLatencySeconds).toBeNull();
        expect(parseQueueMonitorSnapshot(value).sweepAgeSeconds).toBeNull();
    });
    it('supports no current request without claiming no work remains', () => {
        const value = fixture(); value.currentRequest = null;
        expect(parseQueueMonitorSnapshot(value).candidates.sampleCount).toBe(3);
        expect(queueMonitorWarnings(value)).toContain('LATENCY_UNMEASURED');
    });
    it.each([
        ['actor.role', 'sales'], ['actor.role', 'owner'], ['actor.userId', 'invalid'], ['contractVersion', 'old'],
        ['asOf', '2026-02-30T00:00:00Z'], ['asOf', '2026-09-23'], ['readOnly', false], ['targetSeconds', 600],
        ['deliveryLatencySeconds', 0], ['sweepAgeSeconds', 0], ['gates.burst', 1], ['gates.processing', null],
        ['candidates.sampleCount', 902], ['candidates.sampleCount', -1], ['candidates.sampleCount', '3'],
        ['candidates.sampleCount', -0], ['candidates.sampleCount', 0.5], ['candidates.scanLimit', 900],
        ['candidates.exact', false], ['candidates.storedHeldCount', 3], ['candidates.withoutStoredReviewCount', 3],
        ['cursor.afterTaskId', admin], ['cursor.afterCreatedAt', '2026-09-23T00:00:00Z'],
        ['currentRequest.status', 'executing'], ['currentRequest.status', ['reserved']], ['currentRequest.policyVersion', ['bounded_burst_v2']],
        ['currentRequest.policyVersion', 'unknown'], ['currentRequest.attemptCount', 0], ['currentRequest.attemptCount', 6],
        ['currentRequest.preparedAt', '2026-09-24T00:00:00Z'], ['currentRequest.preparedAt', '2026-09-22T00:00:00Z'],
        ['currentRequest.nextAttemptAt', '2026-09-22T00:00:00Z'], ['currentRequest.completedAt', '2026-09-23T08:01:00Z'],
        ['currentRequest.lastErrorCode', 'PRIVATE_RAW_ERROR'], ['currentRequest.status', 'review'], ['currentRequest.status', 'retry_wait'],
    ])('fails closed for invalid %s = %j', (path, next) => {
        const value = fixture(); setPath(value, path, next); expect(() => parseQueueMonitorSnapshot(value)).toThrow();
    });
    it.each([
        ['currentRequest.receipt', null], ['currentRequest.receipt.startedAt', '2026-09-23T07:00:00Z'],
        ['currentRequest.receipt.finishedAt', '2026-09-23T08:00:00Z'], ['currentRequest.receipt.finishedAt', '2026-09-23T08:00:03Z'],
        ['currentRequest.receipt.processedCount', 11], ['currentRequest.receipt.heldCount', 3],
        ['currentRequest.receipt.sweepFinished', 'true'], ['currentRequest.completedAt', '2026-09-24T00:00:00Z'],
        ['currentRequest.completedAt', '2026-09-22T00:00:00Z'],
        ['currentRequest.preparedAt', '2026-09-23T08:00:01.000001Z'],
    ])('rejects inconsistent completed cycle %s', (path, next) => {
        const value = completed(); setPath(value, path, next); expect(() => parseQueueMonitorSnapshot(value)).toThrow();
    });
    it('does not leak extra raw fields at any nested level', () => {
        const value = completed();
        for (const part of [value, value.actor, value.gates, value.candidates, value.cursor, value.currentRequest!, value.currentRequest!.receipt!]) {
            Object.assign(part, { secret: 'do-not-return', customerName: 'private', rawError: 'internal' });
        }
        expect(parseQueueMonitorSnapshot(value)).toEqual(completed());
    });
    it('binds the snapshot to the requested verified actor', () => {
        expect(() => parseQueueMonitorSnapshot(fixture(), '00000000-0000-4000-8000-000000000009')).toThrow();
    });
    it('marks the full 901 prefix as a lower bound, never a complete queue', () => {
        const value = fixture(); Object.assign(value.candidates, { sampleCount: 901, exact: false });
        expect(parseQueueMonitorSnapshot(value)).toEqual(value);
        value.candidates.exact = true; expect(() => parseQueueMonitorSnapshot(value)).toThrow();
    });
    it.each(['?actorId=x', '?page=0', '?requestId=x', '?limit=901', '?now=x', '?force=true', '?a=1&a=2'])('rejects all query instructions %s', query => {
        expect(() => parseQueueMonitorQuery(`https://example.test/api${query}`)).toThrow();
    });
    it('accepts only an empty query', () => expect(parseQueueMonitorQuery('https://example.test/api')).toBeUndefined());
});
describe('observations are not recovery or delivery authority', () => {
    it('warns at exactly five server-snapshot minutes but not one microsecond sooner', () => {
        const value = fixture(); expect(queueMonitorWarnings(value)).toContain('REQUEST_AGE_TARGET');
        value.asOf = '2026-09-23T08:05:00Z'; expect(queueMonitorWarnings(value)).not.toContain('REQUEST_AGE_TARGET');
    });
    it('warns reservation boundary elapsed, not failed', () => {
        const value = fixture(); value.asOf = value.currentRequest!.nextAttemptAt;
        expect(queueMonitorWarnings(value)).toContain('RESERVATION_ELAPSED');
        value.asOf = '2026-09-23T08:01:00Z'; expect(queueMonitorWarnings(value)).not.toContain('RESERVATION_ELAPSED');
    });
    it.each(['RETRY_LIMIT', 'PROCESSING_REVIEW'] as const)('preserves terminal review reason %s', lastErrorCode => {
        const value = fixture(); Object.assign(value.currentRequest!, { status: 'review', attemptCount: 5, lastErrorCode });
        expect(parseQueueMonitorSnapshot(value)).toEqual(value);
        expect(queueMonitorWarnings(value)).toEqual(expect.arrayContaining(['REVIEW_REQUIRED', 'ATTEMPT_LIMIT']));
        expect(queueMonitorWarnings(value)).not.toContain('RESERVATION_ELAPSED');
    });
    it('identifies retry wait without claiming the clock authorizes retry', () => {
        const value = fixture(); Object.assign(value.currentRequest!, { status: 'retry_wait', lastErrorCode: 'TRANSIENT_RETRY' });
        expect(parseQueueMonitorSnapshot(value)).toEqual(value);
        expect(queueMonitorWarnings(value)).toContain('RETRY_WAIT');
        expect(queueMonitorWarnings(value)).not.toContain('RESERVATION_ELAPSED');
    });
    it('does not treat completed burst nextAttemptAt as an active timer', () => {
        expect(queueMonitorWarnings(completed())).not.toContain('RESERVATION_ELAPSED');
        expect(queueMonitorWarnings(completed())).not.toContain('REQUEST_AGE_TARGET');
    });
    it('retains read observations while write gates are off', () => {
        const value = fixture(); value.gates = { processing: false, cycle: false, worker: false, dispatcher: false, burst: false };
        expect(parseQueueMonitorSnapshot(value)).toEqual(value);
        expect(queueMonitorWarnings(value)).toEqual(expect.arrayContaining(['WRITERS_DISABLED', 'BURST_DISABLED', 'STORED_HELD', 'MISSING_STORED_REVIEW']));
    });
    it('never emits a delivery guarantee for an empty sample and no request', () => {
        const value = fixture(); value.currentRequest = null;
        Object.assign(value.candidates, { sampleCount: 0, storedHeldCount: 0, withoutStoredReviewCount: 0 });
        expect(queueMonitorWarnings(parseQueueMonitorSnapshot(value))).toEqual(['LATENCY_UNMEASURED']);
    });
});
