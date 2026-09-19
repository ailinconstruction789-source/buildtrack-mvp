import { describe, expect, it } from 'vitest';
import { parseSlaProcessingInput, parseSlaProcessingResult, SLA_PROCESSING_HELD_REASONS, type SlaProcessingResult } from '../slaProcessingContracts';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002';
const TASK = '00000000-0000-4000-8000-000000000003';
const NOTICE = '00000000-0000-4000-8000-000000000004';
const ACTIVITY = '00000000-0000-4000-8000-000000000005';
const NOW = '2026-09-17T03:00:00.000001Z', DUE = '2026-09-17T03:30:00.000001Z';
const input = { requestId: REQUEST, taskId: TASK };
function receipt(changes: Partial<SlaProcessingResult> = {}): SlaProcessingResult {
    return { actor: { userId: ADMIN, role: 'admin' }, ...input, processedAt: NOW, replayed: false,
        outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: DUE, staffDueAt: null,
        notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null, withdrawnCount: 0, ...changes };
}
const parse = (value: unknown) => parseSlaProcessingResult(value, input, ADMIN);

describe('only task and stable request identity may enter the processor', () => {
    it('normalizes UUIDs without mutating the caller', () => {
        const raw = Object.freeze({ requestId: 'ABCDEFAB-0000-4000-8000-000000000002', taskId: TASK });
        expect(parseSlaProcessingInput(raw)).toEqual({ ...raw, requestId: raw.requestId.toLowerCase() });
    });
    it.each([null, [], '', {}, { taskId: TASK }, { requestId: REQUEST }, { ...input, taskId: null },
        { ...input, taskId: `${TASK}\n` }, { ...input, requestId: ` ${REQUEST}` }, { ...input, requestId: 1 },
        ...['ownerUserId', 'staffDueAt', 'asOf', 'calendar', 'notificationBinding', 'preview', 'completedByActivityId', 'actor'].map(key => ({ ...input, [key]: 'forged' })),
    ])('rejects a malformed or authority-bearing command %#', value => expect(() => parseSlaProcessingInput(value)).toThrow());
    it('rejects inherited keys', () => expect(() => parseSlaProcessingInput(Object.create(input))).toThrow());
});

describe('minimal historical processing receipt', () => {
    it.each(SLA_PROCESSING_HELD_REASONS)('accepts held reason %s without inferred times', reason => {
        expect(parse(receipt({ reason }))).toEqual(receipt({ reason }));
    });
    it('strips private extra fields from both receipt and actor', () => {
        expect(parse({ ...receipt(), actor: { userId: ADMIN, role: 'admin', token: 'private' }, calendar: 'private', source: 'private', phone: 'private' })).toEqual(receipt());
    });
    it.each(['notified', 'already_notified'] as const)('accepts a matching %s notice only', outcome => {
        const result = receipt({ outcome, reason: 'DUE_SOON', notificationId: NOTICE, notificationType: 'due_soon', staffDueAt: DUE });
        expect(parse(result)).toEqual(result);
        expect(() => parse({ ...result, notificationType: 'overdue' })).toThrow();
        expect(() => parse({ ...result, notificationId: null })).toThrow();
    });
    it('uses exact microseconds: at due is due-soon, a microsecond after is overdue', () => {
        const due = receipt({ outcome: 'notified', reason: 'DUE_SOON', notificationId: NOTICE, notificationType: 'due_soon', staffDueAt: NOW });
        expect(parse(due).outcome).toBe('notified');
        expect(() => parse({ ...due, processedAt: '2026-09-17T03:00:00.000002Z' })).toThrow();
        expect(parse({ ...due, processedAt: '2026-09-17T03:00:00.000002Z', reason: 'OVERDUE', notificationType: 'overdue' }).reason).toBe('OVERDUE');
        expect(() => parse({ ...due, reason: 'OVERDUE', notificationType: 'overdue' })).toThrow();
    });
    it.each(['NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS'] as const)('allows scheduled reason %s with no notice', reason => {
        expect(parse(receipt({ outcome: 'scheduled', reason, staffDueAt: DUE })).reason).toBe(reason);
    });
    it('withdrawn-key suppression never claims a delivered notice', () => {
        const result = receipt({ outcome: 'suppressed', reason: 'WITHDRAWN_NOTIFICATION', staffDueAt: DUE });
        expect(parse(result)).toEqual(result);
        expect(() => parse({ ...result, notificationId: NOTICE })).toThrow();
    });
    it('completed receipt requires an actual activity and historical contact time, not processing time credit', () => {
        const result = receipt({ outcome: 'completed', reason: 'CONTACT_PROVEN', completedByActivityId: ACTIVITY, completedAt: '2026-09-17T02:00:00.123456Z' });
        expect(parse(result)).toEqual(result);
        expect(() => parse({ ...result, completedByActivityId: null })).toThrow();
        expect(() => parse({ ...result, completedAt: '2026-09-17T03:00:00.000002Z' })).toThrow();
    });
    it('closed is not a new completion', () => {
        expect(parse(receipt({ outcome: 'closed', reason: 'TASK_CLOSED' })).completedAt).toBeNull();
        expect(() => parse(receipt({ outcome: 'closed', reason: 'TASK_CLOSED', completedByActivityId: ACTIVITY, completedAt: NOW }))).toThrow();
    });
    it('replay preserves the original processing instant instead of checking against the browser clock', () => {
        expect(parse(receipt({ replayed: true, processedAt: '2026-01-01T00:00:00.123456+07:00' })).processedAt).toBe('2026-01-01T00:00:00.123456+07:00');
    });
    it.each([
        { actor: { userId: TASK, role: 'admin' } }, { actor: { userId: ADMIN, role: 'sales' } }, { actor: null },
        { requestId: TASK }, { taskId: REQUEST }, { replayed: 'true' }, { outcome: 'sent' }, { reason: 'UNKNOWN' },
        { processedAt: '2026-02-30T00:00:00Z' }, { processedAt: '2026-09-17T03:00:00.1234567Z' },
        { processedAt: '2026-09-17T03:00:00Z\n' }, { serviceDueAt: 'infinity' }, { serviceDueAt: null },
        { staffDueAt: DUE }, { notificationId: NOTICE }, { notificationType: 'due_soon' },
        { completedAt: NOW }, { completedByActivityId: ACTIVITY }, { withdrawnCount: -1 },
        { withdrawnCount: 0.5 }, { withdrawnCount: NaN }, { withdrawnCount: 2147483648 },
    ])('rejects malformed/contradictory result %# as uncertain', change => expect(() => parse({ ...receipt(), ...change })).toThrow());
    it.each(Object.keys(receipt()))('requires receipt field %s', key => {
        const value: Record<string, unknown> = { ...receipt() }; delete value[key];
        expect(() => parse(value)).toThrow();
    });
    it.each([
        { outcome: 'scheduled', reason: 'DUE_SOON', staffDueAt: DUE },
        { outcome: 'scheduled', reason: 'NOT_DUE_YET', staffDueAt: null },
        { outcome: 'completed', reason: 'TASK_CLOSED' }, { outcome: 'closed', reason: 'CONTACT_PROVEN' },
        { outcome: 'suppressed', reason: 'MISSING_CALENDAR', staffDueAt: DUE },
    ])('rejects crossed state/reason fields %#', change => expect(() => parse({ ...receipt(), ...change })).toThrow());
});
