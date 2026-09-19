import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLeadWorkPending, LeadWorkPendingError, leadWorkPendingKey, readLeadWorkPending, writeLeadWorkPending } from '../leadWorkPending';
import { bangkokInputTimestamp, bangkokTimestampInput, isLeadWorkOverdue } from '../leadWorkDates';
import { parseLeadWorkInput } from '../leadWorkContracts';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const scope = { customerId: CUSTOMER, interestId: null };
const input = parseLeadWorkInput({ requestId: OTHER, command: 'set_next_action', ...scope, expectedActionId: null,
    nextAction: { action: 'โทรติดตาม', dueAt: '2026-09-18T09:45:32.123456+07:00' }, reason: 'ลูกค้าขอนัดใหม่' });
beforeEach(() => sessionStorage.clear());

describe('durable per-tab lead-work command receipt', () => {
    it('round-trips exactly with microseconds and only the minimum command envelope', () => {
        writeLeadWorkPending(ACTOR, scope, input);
        expect(readLeadWorkPending(ACTOR, scope)).toEqual(input);
        const stored = JSON.parse(sessionStorage.getItem(leadWorkPendingKey(ACTOR, scope))!);
        expect(Object.keys(stored).sort()).toEqual(['actorUserId', 'input', 'uncertain', 'version']);
        expect(stored.uncertain).toBe(true);
        expect(JSON.stringify(stored)).not.toMatch(/token|customerName|phone|snapshot/);
    });
    it('isolates actor, customer and central-vs-project scope without scanning other receipts', () => {
        writeLeadWorkPending(ACTOR, scope, input);
        expect(readLeadWorkPending(OTHER, scope)).toBeNull();
        expect(readLeadWorkPending(ACTOR, { ...scope, interestId: OTHER })).toBeNull();
        expect(readLeadWorkPending(ACTOR, { ...scope, customerId: OTHER })).toBeNull();
    });
    it('does not replace an existing different command or clear it with a different request ID', () => {
        writeLeadWorkPending(ACTOR, scope, input);
        const changed = { ...input, requestId: ACTOR };
        expect(() => writeLeadWorkPending(ACTOR, scope, changed)).toThrow(LeadWorkPendingError);
        expect(() => clearLeadWorkPending(ACTOR, scope, changed)).toThrow(LeadWorkPendingError);
        expect(readLeadWorkPending(ACTOR, scope)).toEqual(input);
    });
    it.each(['bad JSON', '{}', 'null', '[]'])('blocks corrupt receipt %j without discarding it', raw => {
        const key = leadWorkPendingKey(ACTOR, scope); sessionStorage.setItem(key, raw);
        expect(() => readLeadWorkPending(ACTOR, scope)).toThrow(LeadWorkPendingError);
        expect(() => writeLeadWorkPending(ACTOR, scope, input)).toThrow(LeadWorkPendingError);
        expect(sessionStorage.getItem(key)).toBe(raw);
    });
    it.each([{ actorUserId: OTHER }, { version: 2 }, { uncertain: false }, { input: { ...input, customerId: OTHER } }, { input: { ...input, ownerUserId: ACTOR } }])('blocks altered envelope %j', changes => {
        sessionStorage.setItem(leadWorkPendingKey(ACTOR, scope), JSON.stringify({ version: 1, actorUserId: ACTOR, uncertain: true, input, ...changes }));
        expect(() => readLeadWorkPending(ACTOR, scope)).toThrow(LeadWorkPendingError);
    });
    it('requires storage read-back and propagates denied writes/reads as a safe block', () => {
        const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
        expect(() => writeLeadWorkPending(ACTOR, scope, input, storage)).toThrow(LeadWorkPendingError);
        storage.getItem.mockImplementation(() => { throw new Error('private diagnostic'); });
        expect(() => readLeadWorkPending(ACTOR, scope, storage)).toThrow(/Admin/);
    });
    it('clears only the acknowledged same request and verifies removal', () => {
        writeLeadWorkPending(ACTOR, scope, input); clearLeadWorkPending(ACTOR, scope, input);
        expect(readLeadWorkPending(ACTOR, scope)).toBeNull();
    });
});

describe('explicit Bangkok wall-clock conversions', () => {
    it('never lets machine timezone determine submitted times', () => {
        expect(bangkokInputTimestamp('2026-09-18T09:45')).toBe('2026-09-18T09:45:00+07:00');
        expect(bangkokInputTimestamp('2026-09-18T09:45:32')).toBe('2026-09-18T09:45:32+07:00');
        expect(bangkokTimestampInput('2026-09-18T02:45:32.123456Z')).toBe('2026-09-18T09:45:32');
    });
    it.each(['', '2026-02-29T09:00', '2026-09-18T24:00', '2026-09-18T09:45Z', '2026-09-18T09:45\n'])('rejects invalid local date %j', value => {
        expect(() => bangkokInputTimestamp(value)).toThrow();
    });
    it('uses server asOf with microsecond accuracy rather than the local clock', () => {
        expect(isLeadWorkOverdue('2026-09-18T09:45:00.000001+07:00', '2026-09-18T02:45:00.000002Z')).toBe(true);
        expect(isLeadWorkOverdue('2026-09-18T09:45:00+07:00', '2026-09-18T02:45:00Z')).toBe(false);
    });
});
