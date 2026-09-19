import { describe, expect, it } from 'vitest';
import { parseLeadLifecycleContext, parseLeadLifecycleResult } from '../leadLifecycleReadContracts';
import type { CrmRole } from '../centralContracts';

const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const CUSTOMER = '00000000-0000-4000-8000-000000000001';
const INTEREST = '00000000-0000-4000-8000-000000000002';
const ACTION = '00000000-0000-4000-8000-000000000003';
const OTHER = '00000000-0000-4000-8000-000000000004';
const REVISION = '00000000-0000-4000-8000-000000000005';
const scope = { customerId: CUSTOMER, interestId: null };
function context(role: CrmRole = 'admin', owns = true, closed = false, project = false, booking = false, interests = false, active = true) {
    return { work: { actor: { userId: USER, role }, scope: { customerId: CUSTOMER, interestId: project ? INTEREST : null },
        customer: { id: CUSTOMER, name: 'ลูกค้า', phone: null, leadCreatedAt: null }, projectName: project ? 'โครงการ A' : null,
        owner: { userId: owns ? USER : OTHER, displayName: null, active }, scopeClosed: closed, lifecycleRevision: REVISION,
        canWrite: !closed && active && (role === 'admin' || role === 'sales' && owns), asOf: '2026-09-16T12:00:00.979649+07:00',
        currentAction: null, actions: [], activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } },
    candidates: role === 'admin' ? [{ userId: USER, displayName: null }] : [], candidatesTruncated: false,
    canReassign: !closed && role === 'admin', canClose: !closed && (role === 'admin' || role === 'sales' && owns) && !booking && !(interests && !project),
    blockers: { hasBookingHistory: booking, hasOpenInterests: interests }, impact: { openSlaCount: 2, pendingNotificationCount: 5 } };
}
const candidates = (length: number) => Array.from({ length }, (_, index) => ({ userId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, displayName: null }));

describe('lifecycle read context projection', () => {
    it('projects embedded v2 work, nullable legacy facts and no private fields without mutation', () => {
        const data = context();
        const raw = { ...data, privateDump: 'hidden', work: { ...data.work, privateDump: 'hidden' },
            candidates: [{ ...data.candidates[0], privateData: 'hidden' }], impact: { ...data.impact, forecast: 999 } };
        const serialized = JSON.stringify(raw);
        expect(parseLeadLifecycleContext(raw, scope)).toEqual(data); expect(JSON.stringify(raw)).toBe(serialized);
        expect(parseLeadLifecycleContext(data).work.asOf).toBe('2026-09-16T12:00:00.979649+07:00');
    });

    for (const role of ['sales', 'admin', 'owner'] as const) {
        for (const owns of [true, false]) for (const closed of [true, false]) for (const booking of [true, false]) {
            it(`enforces exact rights role=${role} owns=${owns} closed=${closed} booking=${booking}`, () => {
                const data = context(role, owns, closed, false, booking);
                expect(parseLeadLifecycleContext(data)).toEqual(data);
                expect(() => parseLeadLifecycleContext({ ...data, canReassign: !data.canReassign })).toThrow();
                expect(() => parseLeadLifecycleContext({ ...data, canClose: !data.canClose })).toThrow();
            });
        }
    }

    it('lets Admin rescue an inactive owner despite work.canWrite=false, and retains candidates for a closed scope', () => {
        const inactive = context('admin', false, false, false, false, false, false);
        expect(parseLeadLifecycleContext(inactive)).toMatchObject({ canReassign: true, canClose: true, work: { canWrite: false } });
        expect(parseLeadLifecycleContext(context('admin', true, true))).toMatchObject({ candidates: [{ userId: USER }], canReassign: false });
    });

    it('blocks only central close for open interests and rejects that blocker on project scope', () => {
        expect(parseLeadLifecycleContext(context('admin', true, false, false, false, true)).canClose).toBe(false);
        expect(parseLeadLifecycleContext(context('admin', true, false, true)).canClose).toBe(true);
        expect(() => parseLeadLifecycleContext(context('admin', true, false, true, false, true))).toThrow();
    });

    it('binds requested customer and optional interest, requires read-v2 revision, and validates embedded times', () => {
        expect(() => parseLeadLifecycleContext(context(), { ...scope, customerId: OTHER })).toThrow();
        expect(() => parseLeadLifecycleContext(context(), { ...scope, interestId: INTEREST })).toThrow();
        for (const work of [{ ...context().work, lifecycleRevision: undefined }, { ...context().work, asOf: '2026-02-30T00:00:00Z' },
            { ...context().work, asOf: '2026-09-16T12:00:00Z\n' }]) {
            expect(() => parseLeadLifecycleContext({ ...context(), work })).toThrow();
        }
    });

    it.each([null, undefined, [], {}, 'context'])('rejects malformed root %j', value => { expect(() => parseLeadLifecycleContext(value)).toThrow(); });
    it.each(['work', 'candidates', 'candidatesTruncated', 'canReassign', 'canClose', 'blockers', 'impact'])('requires field %s', key => {
        const data: Record<string, unknown> = { ...context() }; delete data[key]; expect(() => parseLeadLifecycleContext(data)).toThrow();
    });
    it.each(['canClose', 'canReassign', 'candidatesTruncated'])('requires boolean %s without coercion', field => {
        for (const value of [undefined, null, 0, 1, 'true', 'false']) expect(() => parseLeadLifecycleContext({ ...context(), [field]: value })).toThrow();
    });
    it.each(['hasBookingHistory', 'hasOpenInterests'])('requires boolean blocker %s', field => {
        for (const value of [undefined, null, 'false', 0]) expect(() => parseLeadLifecycleContext({ ...context(), blockers: { ...context().blockers, [field]: value } })).toThrow();
    });
    it.each(['openSlaCount', 'pendingNotificationCount'] as const)('requires nonnegative safe integer impact %s', field => {
        for (const value of [undefined, null, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
            expect(() => parseLeadLifecycleContext({ ...context(), impact: { ...context().impact, [field]: value } })).toThrow();
        }
        expect(parseLeadLifecycleContext({ ...context(), impact: { ...context().impact, [field]: 0 } }).impact[field]).toBe(0);
    });

    it.each(['sales', 'owner'] as const)('requires no candidate disclosure for %s', role => {
        expect(() => parseLeadLifecycleContext({ ...context(role), candidates: [{ userId: OTHER, displayName: null }] })).toThrow();
        expect(() => parseLeadLifecycleContext({ ...context(role), candidates: candidates(200), candidatesTruncated: true })).toThrow();
    });
    it('accepts at most 200 candidates, with truncation only for a full page', () => {
        for (const candidatesTruncated of [true, false]) {
            expect(parseLeadLifecycleContext({ ...context(), candidates: candidates(200), candidatesTruncated }).candidates).toHaveLength(200);
        }
        expect(() => parseLeadLifecycleContext({ ...context(), candidates: candidates(201) })).toThrow();
        expect(() => parseLeadLifecycleContext({ ...context(), candidatesTruncated: true })).toThrow();
    });
    it('normalizes candidate UUIDs and rejects duplicates after normalization', () => {
        expect(parseLeadLifecycleContext({ ...context(), candidates: [{ userId: USER.toUpperCase(), displayName: 'Sales 🙏' }] }).candidates).toEqual([{ userId: USER, displayName: 'Sales 🙏' }]);
        expect(() => parseLeadLifecycleContext({ ...context(), candidates: [{ userId: USER, displayName: null }, { userId: USER.toUpperCase(), displayName: null }] })).toThrow();
    });
    it.each([null, {}, { userId: USER }, { userId: `${USER}\n`, displayName: null }, { userId: USER, displayName: 5 },
        { userId: USER, displayName: '\ud800' }, { userId: USER, displayName: '\udfff' }, { userId: USER, displayName: '\u0000' }])('rejects malformed candidate %j', candidate => {
        expect(() => parseLeadLifecycleContext({ ...context(), candidates: [candidate] })).toThrow();
    });
});

describe('lifecycle successful-command result validation', () => {
    const result = { revision: REVISION, nextActionId: null, replayed: false };
    const close = { command: 'close_lost' as const, expectedActionId: ACTION };
    it('projects normalized IDs and explicit replay without leaking extras', () => {
        expect(parseLeadLifecycleResult({ ...result, revision: USER.toUpperCase(), privateDump: 'secret' }, close)).toEqual({ ...result, revision: USER });
        expect(parseLeadLifecycleResult({ ...result, replayed: true }, close).replayed).toBe(true);
    });
    it('requires close to remove any current action', () => {
        expect(() => parseLeadLifecycleResult({ ...result, nextActionId: OTHER }, close)).toThrow();
    });
    it('requires reassignment to preserve action presence and create a different version', () => {
        const reassign = { command: 'reassign_owner' as const, expectedActionId: null };
        expect(parseLeadLifecycleResult(result, reassign)).toEqual(result);
        expect(parseLeadLifecycleResult({ ...result, nextActionId: OTHER }, { ...reassign, expectedActionId: ACTION }).nextActionId).toBe(OTHER);
        expect(() => parseLeadLifecycleResult({ ...result, nextActionId: OTHER }, reassign)).toThrow();
        expect(() => parseLeadLifecycleResult(result, { ...reassign, expectedActionId: ACTION })).toThrow();
        expect(() => parseLeadLifecycleResult({ ...result, nextActionId: USER.toUpperCase() }, { ...reassign, expectedActionId: USER })).toThrow();
    });
    it.each([null, [], {}, { ...result, revision: '' }, { ...result, revision: `${REVISION}\n` }, { ...result, nextActionId: undefined },
        { ...result, nextActionId: 'bad' }, { ...result, replayed: 1 }])('rejects malformed reply %j', value => {
        expect(() => parseLeadLifecycleResult(value, close)).toThrow();
    });
});
