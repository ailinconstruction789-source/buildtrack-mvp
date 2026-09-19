import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWorkScheduleInput, WORK_SCHEDULE_MAX_BODY_BYTES, type WorkScheduleInput } from '../workScheduleContracts';
import { clearWorkSchedulePending, readWorkSchedulePending, WorkSchedulePendingError, workSchedulePendingKey, writeWorkSchedulePending } from '../workSchedulePending';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACTOR = '00000000-0000-4000-8000-000000000001';
const SALES = '00000000-0000-4000-8000-000000000002';
const OTHER_SALES = '00000000-0000-4000-8000-000000000003';
const REQUEST = '00000000-0000-4000-8000-000000000004';
const VERSION = '00000000-0000-4000-8000-000000000005';
const input = parseWorkScheduleInput({ requestId: REQUEST, salesUserId: SALES, expectedVersion: null,
    coverage: { startsAt: '2026-09-01T00:00:00.000001+07:00', endsAt: '2026-10-01T00:00:00.123456+07:00' },
    periods: [{ type: 'work', startsAt: '2026-09-01T09:00:00.123456+07:00', endsAt: '2026-09-01T18:00:00.123456+07:00' }],
    confirmedComplete: true, reason: 'จัดเวรตามที่ตกลง' });
function rawEnvelope(payload: unknown = input, extra: Record<string, unknown> = {}) {
    return JSON.stringify({ version: 1, actorId: ACTOR, payload, ...extra });
}
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('work schedule Admin-wide pending queue', () => {
    it('stores only the exact actor-bound command and preserves timestamp precision', () => {
        writeWorkSchedulePending(ACTOR, input);
        expect(readWorkSchedulePending(ACTOR)).toEqual(input);
        const envelope = JSON.parse(sessionStorage.getItem(workSchedulePendingKey(ACTOR))!);
        expect(Object.keys(envelope).sort()).toEqual(['actorId', 'payload', 'version']);
        expect(envelope).toEqual({ version: 1, actorId: ACTOR, payload: input });
        expect(JSON.stringify(envelope)).not.toMatch(/token|displayName|phone|snapshot/);
    });
    it('normalizes UUID case and reason without mutating the supplied command', () => {
        const supplied = { ...input, reason: '  จัดเวร  ', expectedVersion: VERSION };
        writeWorkSchedulePending(ACTOR.toUpperCase(), supplied);
        expect(readWorkSchedulePending(ACTOR)).toEqual({ ...supplied, reason: 'จัดเวร' });
        expect(supplied.reason).toBe('  จัดเวร  ');
        expect(workSchedulePendingKey(ACTOR.toUpperCase())).toBe(workSchedulePendingKey(ACTOR));
    });
    it('deeply freezes recovered commands, including coverage and every period', () => {
        writeWorkSchedulePending(ACTOR, input);
        const restored = readWorkSchedulePending(ACTOR)!;
        expect(Object.isFrozen(restored)).toBe(true);
        expect(Object.isFrozen(restored.coverage)).toBe(true);
        expect(Object.isFrozen(restored.periods)).toBe(true);
        expect(Object.isFrozen(restored.periods[0])).toBe(true);
        expect(restored).not.toBe(input);
        expect(restored.periods).not.toBe(input.periods);
    });
    it('has one queue across all Sales targets, while isolating different Admin actors', () => {
        writeWorkSchedulePending(ACTOR, input);
        const changedTarget = { ...input, requestId: OTHER_ACTOR, salesUserId: OTHER_SALES };
        expect(() => writeWorkSchedulePending(ACTOR, changedTarget)).toThrow(WorkSchedulePendingError);
        expect(readWorkSchedulePending(ACTOR)).toEqual(input);
        expect(readWorkSchedulePending(OTHER_ACTOR)).toBeNull();
        writeWorkSchedulePending(OTHER_ACTOR, changedTarget);
        expect(readWorkSchedulePending(OTHER_ACTOR)).toEqual(changedTarget);
        expect(sessionStorage.length).toBe(2);
        expect(workSchedulePendingKey(ACTOR)).not.toContain(SALES);
    });
    it('allows exact same-key retries without manufacturing a new request', () => {
        writeWorkSchedulePending(ACTOR, input);
        const original = sessionStorage.getItem(workSchedulePendingKey(ACTOR));
        writeWorkSchedulePending(ACTOR, readWorkSchedulePending(ACTOR)!);
        expect(sessionStorage.getItem(workSchedulePendingKey(ACTOR))).toBe(original);
    });
    it.each([
        { requestId: OTHER_ACTOR }, { salesUserId: OTHER_SALES }, { expectedVersion: VERSION },
        { reason: 'แก้เหตุผล' }, { periods: [] },
        { coverage: { ...input.coverage, endsAt: '2026-10-02T00:00:00+07:00' } },
    ])('refuses replacement of any pending command field: %j', change => {
        writeWorkSchedulePending(ACTOR, input);
        const original = sessionStorage.getItem(workSchedulePendingKey(ACTOR));
        expect(() => writeWorkSchedulePending(ACTOR, { ...input, ...change })).toThrow(WorkSchedulePendingError);
        expect(sessionStorage.getItem(workSchedulePendingKey(ACTOR))).toBe(original);
    });
    it.each(['', 'not-a-uuid', `${ACTOR}\n`, null, 12])('rejects invalid actor %j', actor => {
        expect(() => workSchedulePendingKey(actor as string)).toThrow(WorkSchedulePendingError);
        expect(() => readWorkSchedulePending(actor as string)).toThrow(WorkSchedulePendingError);
        expect(() => writeWorkSchedulePending(actor as string, input)).toThrow(WorkSchedulePendingError);
        expect(() => clearWorkSchedulePending(actor as string, REQUEST)).toThrow(WorkSchedulePendingError);
        expect(sessionStorage.length).toBe(0);
    });
    it.each([
        { salesUserId: 'bad' }, { actorId: ACTOR }, { confirmedComplete: false }, { reason: '\n' },
        { coverage: { ...input.coverage, complete: true } },
        { periods: [{ ...input.periods[0], id: VERSION }] },
    ])('rejects invalid or additional command fields before storage: %j', change => {
        expect(() => writeWorkSchedulePending(ACTOR, { ...input, ...change } as WorkScheduleInput)).toThrow(WorkSchedulePendingError);
        expect(sessionStorage.length).toBe(0);
    });
    it.each(['bad JSON', '{}', 'null', '[]', rawEnvelope(input, { version: 2 }),
        rawEnvelope(input, { actorId: OTHER_ACTOR }), rawEnvelope(input, { token: 'do-not-expose' }),
        rawEnvelope({ ...input, salesUserId: 'bad' }), rawEnvelope({ ...input, unexpected: true }),
        rawEnvelope({ ...input, coverage: { ...input.coverage, complete: true } }),
        ' '.repeat(WORK_SCHEDULE_MAX_BODY_BYTES + 1025),
    ])('preserves corrupt or mismatched queue and refuses reads/writes/clears (%#)', raw => {
        const key = workSchedulePendingKey(ACTOR); sessionStorage.setItem(key, raw);
        expect(() => readWorkSchedulePending(ACTOR)).toThrow(WorkSchedulePendingError);
        expect(() => writeWorkSchedulePending(ACTOR, input)).toThrow(WorkSchedulePendingError);
        expect(() => clearWorkSchedulePending(ACTOR, REQUEST)).toThrow(WorkSchedulePendingError);
        expect(sessionStorage.getItem(key)).toBe(raw);
    });
    it('supports the full bounded 400-period command without an older small-storage limit', () => {
        const beginning = Date.parse('2026-09-01T00:00:00Z');
        const periods = Array.from({ length: 400 }, (_, index) => ({ type: 'work' as const,
            startsAt: new Date(beginning + index * 3_600_000).toISOString().replace('.000Z', '.123456Z'),
            endsAt: new Date(beginning + index * 3_600_000 + 1_800_000).toISOString().replace('.000Z', '.123456Z') }));
        const large = parseWorkScheduleInput({ ...input,
            coverage: { startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }, periods, reason: 'ก'.repeat(1000) });
        expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeGreaterThan(32 * 1024);
        writeWorkSchedulePending(ACTOR, large);
        expect(readWorkSchedulePending(ACTOR)).toEqual(large);
    });
    it('clears only the matching current request and treats an already absent queue as a no-op', () => {
        writeWorkSchedulePending(ACTOR, input);
        expect(() => clearWorkSchedulePending(ACTOR, OTHER_ACTOR)).toThrow(WorkSchedulePendingError);
        expect(() => clearWorkSchedulePending(ACTOR, `${REQUEST}\n`)).toThrow(WorkSchedulePendingError);
        expect(readWorkSchedulePending(ACTOR)).toEqual(input);
        clearWorkSchedulePending(ACTOR, REQUEST);
        expect(readWorkSchedulePending(ACTOR)).toBeNull();
        expect(() => clearWorkSchedulePending(ACTOR, REQUEST)).not.toThrow();
    });
    it.each(['getItem', 'setItem', 'removeItem'] as const)('fails safely on denied storage %s', operation => {
        writeWorkSchedulePending(ACTOR, input);
        const store = { getItem: (key: string) => sessionStorage.getItem(key),
            setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
            removeItem: (key: string) => sessionStorage.removeItem(key) };
        vi.spyOn(store, operation).mockImplementation(() => { throw new Error('private-storage-diagnostic'); });
        const act = operation === 'getItem' ? () => readWorkSchedulePending(ACTOR, store)
            : operation === 'setItem' ? () => writeWorkSchedulePending(ACTOR, input, store)
                : () => clearWorkSchedulePending(ACTOR, REQUEST, store);
        expect(act).toThrow(/ห้ามล้างข้อมูลแท็บ/);
        expect(act).not.toThrow(/private-storage-diagnostic/);
        expect(readWorkSchedulePending(ACTOR)).toEqual(input);
    });
    it('fails closed if sessionStorage itself cannot be accessed', () => {
        vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
        expect(() => readWorkSchedulePending(ACTOR)).toThrow(WorkSchedulePendingError);
        expect(() => writeWorkSchedulePending(ACTOR, input)).toThrow(WorkSchedulePendingError);
        expect(() => clearWorkSchedulePending(ACTOR, REQUEST)).toThrow(WorkSchedulePendingError);
    });
    it('verifies writes instead of assuming setItem persisted data', () => {
        const store = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
        expect(() => writeWorkSchedulePending(ACTOR, input, store)).toThrow(WorkSchedulePendingError);
        expect(store.setItem).toHaveBeenCalledTimes(1);
        expect(store.removeItem).not.toHaveBeenCalled();
    });
    it('rejects a changed write-back and does not silently remove that uncertain queue', () => {
        const raw = rawEnvelope({ ...input, salesUserId: OTHER_SALES });
        const store = { getItem: vi.fn().mockReturnValueOnce(null).mockReturnValue(raw), setItem: vi.fn(), removeItem: vi.fn() };
        expect(() => writeWorkSchedulePending(ACTOR, input, store)).toThrow(WorkSchedulePendingError);
        expect(store.removeItem).not.toHaveBeenCalled();
    });
    it('verifies removal and preserves the remaining uncertain request when removal was ignored', () => {
        writeWorkSchedulePending(ACTOR, input);
        const store = { getItem: (key: string) => sessionStorage.getItem(key), setItem: vi.fn(), removeItem: vi.fn() };
        expect(() => clearWorkSchedulePending(ACTOR, REQUEST, store)).toThrow(WorkSchedulePendingError);
        expect(readWorkSchedulePending(ACTOR)).toEqual(input);
    });
});
