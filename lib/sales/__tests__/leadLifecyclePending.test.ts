import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLeadLifecyclePending, LeadLifecyclePendingError, leadLifecyclePendingKey, readLeadLifecyclePending, writeLeadLifecyclePending } from '../leadLifecyclePending';
import { parseLeadLifecycleInput } from '../leadLifecycleContracts';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const TARGET = '00000000-0000-4000-8000-000000000003';
const REQUEST = '00000000-0000-4000-8000-000000000004';
const REVISION = '00000000-0000-4000-8000-000000000005';
const scope = { customerId: CUSTOMER, interestId: null };
const input = parseLeadLifecycleInput({ command: 'reassign_owner', ...scope, requestId: REQUEST, expectedRevision: REVISION,
    expectedActionId: null, newOwnerUserId: TARGET, reason: 'เปลี่ยนผู้รับผิดชอบ' });
beforeEach(() => sessionStorage.clear());

describe('lifecycle write-ahead receipt', () => {
    it('round-trips only the actor-bound immutable command and revision', () => {
        writeLeadLifecyclePending(ACTOR, scope, input);
        expect(readLeadLifecyclePending(ACTOR, scope)).toEqual(input);
        const stored = JSON.parse(sessionStorage.getItem(leadLifecyclePendingKey(ACTOR, scope))!);
        expect(Object.keys(stored).sort()).toEqual(['actorUserId', 'input', 'uncertain', 'version']);
        expect(stored.uncertain).toBe(true); expect(JSON.stringify(stored)).not.toMatch(/phone|token|customerName|snapshot/);
    });
    it('isolates actor/customer/project while using a different namespace from work commands', () => {
        writeLeadLifecyclePending(ACTOR, scope, input);
        expect(readLeadLifecyclePending(TARGET, scope)).toBeNull();
        expect(readLeadLifecyclePending(ACTOR, { ...scope, interestId: TARGET })).toBeNull();
        expect(readLeadLifecyclePending(ACTOR, { ...scope, customerId: TARGET })).toBeNull();
        expect(leadLifecyclePendingKey(ACTOR, scope)).toContain('lead-lifecycle-pending:v1');
    });
    it.each(['requestId', 'expectedRevision', 'expectedActionId', 'newOwnerUserId'])('does not replace or clear an uncertain command with a changed %s', field => {
        writeLeadLifecyclePending(ACTOR, scope, input);
        const changed = { ...input, [field]: ACTOR };
        expect(() => writeLeadLifecyclePending(ACTOR, scope, changed)).toThrow(LeadLifecyclePendingError);
        expect(() => clearLeadLifecyclePending(ACTOR, scope, changed)).toThrow(LeadLifecyclePendingError);
        expect(readLeadLifecyclePending(ACTOR, scope)).toEqual(input);
    });
    it.each(['bad JSON', '{}', 'null', '[]'])('preserves corrupt storage %j and blocks new writes', raw => {
        const key = leadLifecyclePendingKey(ACTOR, scope); sessionStorage.setItem(key, raw);
        expect(() => readLeadLifecyclePending(ACTOR, scope)).toThrow(LeadLifecyclePendingError);
        expect(() => writeLeadLifecyclePending(ACTOR, scope, input)).toThrow(LeadLifecyclePendingError);
        expect(() => clearLeadLifecyclePending(ACTOR, scope, input)).toThrow(LeadLifecyclePendingError);
        expect(sessionStorage.getItem(key)).toBe(raw);
    });
    it.each([{ actorUserId: TARGET }, { version: 2 }, { uncertain: false }, { input: { ...input, customerId: TARGET } },
        { input: { ...input, actorUserId: ACTOR } }, { input: { ...input, reason: '\u0000' } }])('fails closed on altered envelope %j', changes => {
        sessionStorage.setItem(leadLifecyclePendingKey(ACTOR, scope), JSON.stringify({ version: 1, actorUserId: ACTOR, uncertain: true, input, ...changes }));
        expect(() => readLeadLifecyclePending(ACTOR, scope)).toThrow(LeadLifecyclePendingError);
    });
    it('verifies storage round-trip and treats read/write denial as a safe stop', () => {
        const store = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
        expect(() => writeLeadLifecyclePending(ACTOR, scope, input, store)).toThrow(LeadLifecyclePendingError);
        store.getItem.mockImplementation(() => { throw new Error('private browser error'); });
        expect(() => readLeadLifecyclePending(ACTOR, scope, store)).toThrow(/ห้ามล้างข้อมูลแท็บ/);
    });
    it('removes only a confirmed matching command and verifies actual removal', () => {
        writeLeadLifecyclePending(ACTOR, scope, input); clearLeadLifecyclePending(ACTOR, scope, input);
        expect(readLeadLifecyclePending(ACTOR, scope)).toBeNull();
        writeLeadLifecyclePending(ACTOR, scope, input);
        const store = { getItem: (key: string) => sessionStorage.getItem(key), setItem: vi.fn(), removeItem: vi.fn() };
        expect(() => clearLeadLifecyclePending(ACTOR, scope, input, store)).toThrow(LeadLifecyclePendingError);
        expect(readLeadLifecyclePending(ACTOR, scope)).toEqual(input);
    });
    it('accepts a canonical close command with no target and never changes its ID on read', () => {
        const close = parseLeadLifecycleInput({ command: 'close_lost', ...scope, requestId: REQUEST,
            expectedRevision: REVISION, expectedActionId: TARGET, reason: 'ลูกค้าไม่สนใจแล้ว' });
        writeLeadLifecyclePending(ACTOR, scope, close);
        expect(readLeadLifecyclePending(ACTOR, scope)).toEqual(close);
    });
});
