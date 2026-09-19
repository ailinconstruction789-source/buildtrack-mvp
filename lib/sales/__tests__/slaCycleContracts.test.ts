import { describe, expect, it } from 'vitest';
import { SLA_CYCLE_CONTRACT_VERSION, SLA_CYCLE_MAX_BODY_BYTES, SLA_CYCLE_MAX_ITEMS, SlaCycleInputError, SlaCycleProjectionError,
    parseSlaCycleInput, parseSlaCycleQuery, parseSlaCycleContext, parseSlaCycleResult, parseSlaCycleLookup } from '../slaCycleContracts';

const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { userId: ADMIN, role: 'admin' };
const INPUT = { requestId: REQUEST };
const START = '2026-09-17T02:45:00.123456Z', FINISH = '2026-09-17T02:45:01.123456Z';
function child(index = 0) {
    return { actor, requestId: id(10 + index), taskId: id(100 + index), processedAt: START, replayed: false,
        outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: '2026-09-18T03:00:00Z', staffDueAt: null,
        notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null, withdrawnCount: 0 };
}
function cycle(count = 1) {
    return { actor, ...INPUT, startedAt: START, finishedAt: FINISH, replayed: false, maxItems: 10,
        processedCount: count, sweepFinished: true, receipts: Array.from({ length: count }, (_, n) => child(n)) };
}
function lookup() { return { actor, ...INPUT, found: true, receipt: cycle() }; }

describe('cycle input and read-only query are command-only', () => {
    it('pins fixed version and bounds and canonicalizes only request ID', () => {
        expect(SLA_CYCLE_CONTRACT_VERSION).toBe('first_contact_cycle_v1');
        expect(SLA_CYCLE_MAX_ITEMS).toBe(10); expect(SLA_CYCLE_MAX_BODY_BYTES).toBe(4096);
        expect(parseSlaCycleInput({ requestId: ADMIN.toUpperCase() })).toEqual({ requestId: ADMIN });
        expect(parseSlaCycleQuery('https://app.test/api')).toBeNull();
        expect(parseSlaCycleQuery(`https://app.test/api?requestId=${ADMIN.toUpperCase()}`)).toEqual({ requestId: ADMIN });
    });
    it.each([null, [], {}, '', { requestId: null }, { requestId: 'bad' }, { requestId: `${REQUEST}\n` }, { requestId: ` ${REQUEST}` },
        { ...INPUT, maxItems: 10 }, { ...INPUT, actorId: ADMIN }, { ...INPUT, taskIds: [id(100)] }, { ...INPUT, cursor: {} },
        { ...INPUT, processingEnabled: true }, { ...INPUT, force: true }])('rejects malformed or expanded command %j', value => {
        expect(() => parseSlaCycleInput(value)).toThrow(SlaCycleInputError);
    });
    it.each(['requestId=', 'requestId=bad', `requestId=${REQUEST}%0A`, `requestId=${REQUEST}&requestId=${REQUEST}`,
        `requestId=${REQUEST}&actorId=${ADMIN}`, `requestId=${REQUEST}&maxItems=100`, `requestId=${REQUEST}&process=true`,
        `taskId=${id(100)}`, 'page=0', 'force=true'])('rejects extra, malformed or duplicate query %s', query => {
        expect(() => parseSlaCycleQuery(`https://app.test/api?${query}`)).toThrow(SlaCycleInputError);
    });
    it('rejects an invalid URL', () => { expect(() => parseSlaCycleQuery('not a URL')).toThrow(SlaCycleInputError); });
});

describe('verified Admin fixed-limit capability context', () => {
    it.each([true, false])('projects processing enabled=%s without exposing private flags', processingEnabled => {
        expect(parseSlaCycleContext({ actor: { ...actor, email: 'private' }, processingEnabled, maxItems: 10, cursor: {} }, ADMIN))
            .toEqual({ actor, processingEnabled, maxItems: 10 });
    });
    it.each([null, [], {}, { actor, processingEnabled: true }, { actor, processingEnabled: 'true', maxItems: 10 },
        { actor, processingEnabled: true, maxItems: '10' }, { actor, processingEnabled: true, maxItems: 11 },
        { actor: { userId: OTHER, role: 'admin' }, processingEnabled: true, maxItems: 10 },
        { actor: { ...actor, role: 'owner' }, processingEnabled: true, maxItems: 10 },
        { actor: { ...actor, userId: `${ADMIN}\n` }, processingEnabled: true, maxItems: 10 }])('rejects unbound context %j', value => {
        expect(() => parseSlaCycleContext(value, ADMIN)).toThrow(SlaCycleProjectionError);
    });
});

describe('bounded atomic historical cycle receipt', () => {
    it.each([0, 1, 10])('accepts exactly %i projected child receipts', count => {
        expect(parseSlaCycleResult(cycle(count), INPUT, ADMIN)).toEqual(cycle(count));
    });
    it('allows an unfinished sweep only for a full ten-item cycle', () => {
        const value = { ...cycle(10), sweepFinished: false };
        expect(parseSlaCycleResult(value, INPUT, ADMIN)).toEqual(value);
        for (const count of [0, 1, 9]) {
            expect(() => parseSlaCycleResult({ ...cycle(count), sweepFinished: false }, INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
        }
    });
    it('projects both parent and children without private cursor, calendar, income or actor details', () => {
        const expected = cycle();
        const value = { ...expected, actor: { ...actor, email: 'private' }, cursor: {}, sourceTasks: ['private'],
            receipts: [{ ...child(), actor: { ...actor, phone: 'private' }, rawCalendar: {}, customerIncome: 1000, deliveryKey: 'private' }] };
        expect(parseSlaCycleResult(value, INPUT, ADMIN)).toEqual(expected);
    });
    it('retains historical replay flag, fractional timestamps and equivalent offsets', () => {
        const value = { ...cycle(), replayed: true, startedAt: '2026-09-17T09:45:00.123456+07:00',
            receipts: [{ ...child(), processedAt: FINISH }] };
        expect(parseSlaCycleResult(value, INPUT, ADMIN)).toEqual(value);
    });
    it('accepts children exactly on both inclusive cycle boundaries', () => {
        const value = { ...cycle(2), receipts: [child(), { ...child(1), processedAt: FINISH }] };
        expect(parseSlaCycleResult(value, INPUT, ADMIN)).toEqual(value);
    });
    it('accepts a zero-duration cycle whose child was processed at that exact microsecond', () => {
        const value = { ...cycle(), finishedAt: START };
        expect(parseSlaCycleResult(value, INPUT, ADMIN)).toEqual(value);
    });
    it.each([
        { actor: { userId: OTHER, role: 'admin' } }, { actor: { ...actor, role: 'sales' } }, { requestId: OTHER },
        { startedAt: '2026-09-17T02:45:01.123457Z' }, { finishedAt: '2026-09-17T02:45:00.123455Z' },
        { startedAt: '2026-02-29T00:00:00Z' }, { startedAt: `${START}\n` }, { finishedAt: 'infinity' },
        { startedAt: '0000-01-01T00:00:00Z' }, { finishedAt: '+010000-01-01T00:00:00Z' },
        { replayed: 'false' }, { maxItems: 9 }, { maxItems: '10' }, { processedCount: -1 }, { processedCount: -0 },
        { processedCount: 1.5 }, { processedCount: 11 }, { processedCount: '1' }, { processedCount: 0 },
        { sweepFinished: 'true' }, { sweepFinished: false }, { receipts: null }, { receipts: {} }, { receipts: [] },
    ])('rejects malformed parent or contradictory cycle %j', patch => {
        expect(() => parseSlaCycleResult({ ...cycle(), ...patch }, INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
    });
    it('requires every public field, not inferred defaults', () => {
        for (const key of Object.keys(cycle())) {
            const value: Record<string, unknown> = cycle(); delete value[key];
            expect(() => parseSlaCycleResult(value, INPUT, ADMIN), key).toThrow(SlaCycleProjectionError);
        }
    });
    it.each(['2026-09-17T02:45:00.123455Z', '2026-09-17T02:45:01.123457Z'])('rejects child time outside cycle by one microsecond %s', processedAt => {
        expect(() => parseSlaCycleResult({ ...cycle(), receipts: [{ ...child(), processedAt }] }, INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
    });
    it.each([
        { actor: { userId: OTHER, role: 'admin' } }, { actor: { ...actor, role: 'sales' } }, { requestId: 'bad' },
        { taskId: `${id(100)}\n` }, { outcome: 'completed' }, { staffDueAt: START }, { notificationId: id(50) },
        { withdrawnCount: -1 }, { processedAt: '2026-09-17T02:45:00.1234567Z' }, { replayed: true },
    ])('delegates child validation to the original processing contract %j', patch => {
        expect(() => parseSlaCycleResult({ ...cycle(), receipts: [{ ...child(), ...patch }] }, INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
    });
    it.each(['requestId', 'taskId'] as const)('rejects repeated child %s after UUID normalization', field => {
        const children = [child(), { ...child(1), [field]: child()[field] }];
        expect(() => parseSlaCycleResult({ ...cycle(2), receipts: children }, INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
    });
    it('rejects case-equivalent duplicate child requests', () => {
        expect(() => parseSlaCycleResult({ ...cycle(2), receipts: [{ ...child(), requestId: ADMIN }, { ...child(1), requestId: ADMIN.toUpperCase() }] }, INPUT, ADMIN))
            .toThrow(SlaCycleProjectionError);
    });
    it('rejects eleven children even with matching count', () => {
        expect(() => parseSlaCycleResult(cycle(11), INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
    });
});

describe('own-Admin cycle lookup never proves noncommit', () => {
    it('validates the historical cycle and strips lookup-private fields', () => {
        expect(parseSlaCycleLookup({ ...lookup(), cursor: {}, rawLedger: {} }, INPUT, ADMIN)).toEqual(lookup());
    });
    it('projects absent receipt as observation only', () => {
        expect(parseSlaCycleLookup({ actor, ...INPUT, found: false, receipt: null, definitelyNotProcessed: true }, INPUT, ADMIN))
            .toEqual({ actor, ...INPUT, found: false, receipt: null });
    });
    it.each([null, [], {}, { ...lookup(), actor: { userId: OTHER, role: 'admin' } }, { ...lookup(), requestId: OTHER },
        { ...lookup(), found: 'true' }, { ...lookup(), found: false }, { ...lookup(), receipt: null },
        { actor, ...INPUT, found: false }, { ...lookup(), receipt: { ...cycle(), requestId: OTHER } },
        { ...lookup(), receipt: { ...cycle(), receipts: [{ ...child(), actor: { userId: OTHER, role: 'admin' } }] } }])('rejects unbound lookup %j', value => {
        expect(() => parseSlaCycleLookup(value, INPUT, ADMIN)).toThrow(SlaCycleProjectionError);
    });
    it('requires every lookup field', () => {
        for (const key of Object.keys(lookup())) {
            const value: Record<string, unknown> = lookup(); delete value[key];
            expect(() => parseSlaCycleLookup(value, INPUT, ADMIN), key).toThrow(SlaCycleProjectionError);
        }
    });
});
