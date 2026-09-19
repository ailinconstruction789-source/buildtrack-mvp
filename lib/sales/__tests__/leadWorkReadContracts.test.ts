import { describe, expect, it } from 'vitest';
import { parseLeadWorkScopeQuery, parseLeadWorkSnapshot, parseLeadWorkResult, LeadWorkSnapshotError } from '../leadWorkReadContracts';

const CUSTOMER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const USER = '00000000-0000-4000-8000-000000000001';
const INTEREST = '00000000-0000-4000-8000-000000000002';
const ACTION = '00000000-0000-4000-8000-000000000003';
const ACTIVITY = '00000000-0000-4000-8000-000000000004';
const scope = { customerId: CUSTOMER, interestId: null };
function snapshot() {
    const currentAction = { ...scope, id: ACTION, ownerUserId: USER, action: 'โทรติดตาม', dueAt: '2026-09-16T08:00:00.000001+07:00',
        recordedAt: '2026-09-16T07:00:00.979649+07:00', status: 'open', closedAt: null, closeReason: null };
    return {
        actor: { userId: USER, role: 'sales' }, scope: { ...scope }, customer: { id: CUSTOMER, name: 'ลูกค้า', phone: null, leadCreatedAt: null },
        projectName: null, owner: { userId: USER, displayName: null, active: true }, scopeClosed: false, lifecycleRevision: ACTION, canWrite: true,
        asOf: '2026-09-16T12:00:00.000001+07:00', currentAction, actions: [{ ...currentAction }],
        activities: [{ ...scope, id: ACTIVITY, activityType: 'call', action: 'โทรสอบถาม', channel: 'phone', result: 'no_answer',
            occurredAt: '2026-09-16T08:00:00.123456+07:00', recordedAt: '2026-09-16T08:10:00.000001+07:00', performedByUserId: USER, recordedByUserId: USER, note: null }],
        history: { limit: 20, actionsHasMore: false, activitiesHasMore: false },
    };
}

describe('lead work read scope query', () => {
    it('requires customer and canonicalizes identifiers; omitted interest is central', () => {
        expect(parseLeadWorkScopeQuery(`https://app.test/?customerId=${CUSTOMER.toUpperCase()}`)).toEqual(scope);
        expect(parseLeadWorkScopeQuery(`https://app.test/?customerId=${CUSTOMER}&interestId=${INTEREST}`)).toEqual({ ...scope, interestId: INTEREST });
    });
    it.each(['', '?customerId=', '?customerId=bad', `?customerId=${CUSTOMER}&interestId=`, `?customerId=${CUSTOMER}&interestId=null`,
        `?customerId=${CUSTOMER}&customerId=${CUSTOMER}`, `?customerId=${CUSTOMER}&interestId=${INTEREST}&interestId=${INTEREST}`,
        `?customerId=${CUSTOMER}&page=1`, `?customerId=${CUSTOMER}%0A`, `?interestId=${INTEREST}`])('rejects ambiguous query %s', query => {
        expect(() => parseLeadWorkScopeQuery(`https://app.test/${query}`)).toThrow();
    });
});

describe('lead work snapshot projection', () => {
    it('requires an opaque lifecycle revision and rejects a missing/invalid token', () => {
        for (const lifecycleRevision of [undefined, null, '', '1', `${ACTION}\n`]) {
            expect(() => parseLeadWorkSnapshot({ ...snapshot(), lifecycleRevision })).toThrow();
        }
    });
    it('keeps cancelled work as closed evidence, never an open or successful action', () => {
        const data = snapshot();
        const closed = { ...data.actions[0], status: 'cancelled', closedAt: data.asOf, closeReason: 'ลูกค้าไม่สนใจแล้ว' };
        const result = parseLeadWorkSnapshot({ ...data, scopeClosed: true, canWrite: false, currentAction: null, actions: [closed] });
        expect(result.actions[0]).toEqual(closed);
        expect(() => parseLeadWorkSnapshot({ ...data, currentAction: closed, actions: [closed] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, currentAction: null, actions: [{ ...closed, closeReason: null }] })).toThrow();
    });
    it('accepts a transferred overdue plan without resetting its due date or old owner', () => {
        const data = snapshot();
        const previous = { ...data.actions[0], status: 'superseded', closedAt: '2026-09-16T09:00:00+07:00', closeReason: 'เปลี่ยนผู้ดูแล' };
        const currentAction = { ...data.currentAction, id: INTEREST, ownerUserId: ACTIVITY, recordedAt: previous.closedAt };
        const result = parseLeadWorkSnapshot({ ...data, owner: { ...data.owner, userId: ACTIVITY }, canWrite: false,
            currentAction, actions: [currentAction, previous] });
        expect(result.actions[1].ownerUserId).toBe(USER);
        expect(result.currentAction?.dueAt).toBe(previous.dueAt);
    });
    it('preserves unknown legacy phone/date and microseconds while projecting only contracted fields', () => {
        const data = snapshot();
        expect(parseLeadWorkSnapshot({ ...data, privateDump: 'secret', customer: { ...data.customer, income: 'secret' },
            actions: data.actions.map(row => ({ ...row, privateDump: 'secret' })) }, scope)).toEqual(data);
    });
    it('accepts a valid empty history without pretending its fields may be absent', () => {
        expect(parseLeadWorkSnapshot({ ...snapshot(), currentAction: null, actions: [], activities: [] }).currentAction).toBeNull();
    });
    it('validates a project scope and nullable legacy activity fields without inventing evidence', () => {
        const data = snapshot(); const project = { ...scope, interestId: INTEREST };
        const currentAction = { ...data.currentAction, ...project };
        const result = parseLeadWorkSnapshot({ ...data, scope: project, projectName: 'โครงการ A', currentAction, actions: [currentAction],
            activities: [{ ...data.activities[0], ...project, activityType: 'note', action: null, channel: null, result: null, performedByUserId: null }] }, project);
        expect(result.activities[0].performedByUserId).toBeNull();
    });
    it.each([
        { actor: { userId: USER, role: 'owner' }, canWrite: false },
        { actor: { userId: INTEREST, role: 'sales' }, canWrite: false },
        { actor: { userId: INTEREST, role: 'admin' }, canWrite: true },
        { owner: { userId: USER, displayName: null, active: false }, canWrite: false },
        { scopeClosed: true, canWrite: false },
    ])('accepts the exact permission formula %j', change => {
        expect(parseLeadWorkSnapshot({ ...snapshot(), ...change }).canWrite).toBe(change.canWrite);
        expect(() => parseLeadWorkSnapshot({ ...snapshot(), ...change, canWrite: !change.canWrite })).toThrow(LeadWorkSnapshotError);
    });
    it.each([null, {}, [], false, { ...snapshot(), asOf: '2026-02-30T00:00:00Z' }, { ...snapshot(), asOf: '2026-09-16T12:00:00Z\n' },
        { ...snapshot(), scopeClosed: 'false' }, { ...snapshot(), projectName: 'wrong project' },
        { ...snapshot(), customer: { ...snapshot().customer, id: INTEREST } }, { ...snapshot(), actor: { userId: USER, role: 'super_admin' } },
        { ...snapshot(), owner: { userId: USER, active: true } }])('rejects malformed snapshot %j', value => {
        expect(() => parseLeadWorkSnapshot(value)).toThrow(LeadWorkSnapshotError);
    });
    it('rejects missing/null-mismatched customer fields and requested scope mismatches', () => {
        const data = snapshot();
        expect(() => parseLeadWorkSnapshot({ ...data, customer: { id: CUSTOMER, name: 'ลูกค้า', leadCreatedAt: null } })).toThrow();
        expect(() => parseLeadWorkSnapshot(data, { ...scope, interestId: INTEREST })).toThrow();
        expect(() => parseLeadWorkSnapshot(data, { ...scope, customerId: INTEREST })).toThrow();
    });
    it.each(['actions', 'activities'] as const)('rejects foreign scope, duplicated IDs, excess size and unsorted %s', field => {
        const data = snapshot(); const row = data[field][0];
        expect(() => parseLeadWorkSnapshot({ ...data, [field]: [{ ...row, customerId: INTEREST }] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, [field]: [{ ...row, interestId: INTEREST }] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, [field]: [row, row] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, [field]: Array(21).fill(row) })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, [field]: [row, { ...row, id: USER, recordedAt: '2026-09-16T11:59:59+07:00' }] })).toThrow();
    });
    it('rejects contradictory current actions and closed evidence', () => {
        const data = snapshot();
        for (const change of [{ status: 'superseded' }, { closedAt: data.asOf }, { closeReason: 'closed' }, { ownerUserId: INTEREST }, { action: 'different' }]) {
            expect(() => parseLeadWorkSnapshot({ ...data, currentAction: { ...data.currentAction, ...change } })).toThrow();
        }
        expect(() => parseLeadWorkSnapshot({ ...data, currentAction: null })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, actions: [] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, actions: [...data.actions, { ...data.actions[0], id: USER }] })).toThrow();
    });
    it('validates superseded history timestamps/reasons and exact microsecond chronology', () => {
        const data = snapshot();
        const closed = { ...data.actions[0], status: 'superseded', closedAt: '2026-09-16T09:00:00+07:00', closeReason: 'ติดตามแล้ว' };
        expect(parseLeadWorkSnapshot({ ...data, currentAction: null, actions: [closed] }).actions[0].status).toBe('superseded');
        expect(() => parseLeadWorkSnapshot({ ...data, currentAction: null, actions: [{ ...closed, closeReason: '' }] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, currentAction: null, actions: [{ ...closed, closedAt: '2026-09-16T07:00:00.979648+07:00' }] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, activities: [{ ...data.activities[0], recordedAt: '2026-09-16T12:00:00.000002+07:00' }] })).toThrow();
        expect(() => parseLeadWorkSnapshot({ ...data, activities: [{ ...data.activities[0], recordedAt: '2026-09-16T08:00:00.123455+07:00' }] })).toThrow();
    });
    it('rejects unsupported activity enums, missing actors and timestamp suffixes', () => {
        const data = snapshot();
        for (const change of [{ channel: 'call' }, { result: 'unknown' }, { activityType: 'appointment' }, { recordedByUserId: null }, { recordedAt: `${data.activities[0].recordedAt}\u2028` }]) {
            expect(() => parseLeadWorkSnapshot({ ...data, activities: [{ ...data.activities[0], ...change }] })).toThrow();
        }
    });
    it('validates bounded-history flags instead of silently showing partial history as complete', () => {
        for (const history of [{ limit: 21, actionsHasMore: false, activitiesHasMore: false }, { limit: 20, actionsHasMore: true, activitiesHasMore: false },
            { limit: 20, actionsHasMore: false }, { limit: 20, actionsHasMore: false, activitiesHasMore: 'false' }]) {
            expect(() => parseLeadWorkSnapshot({ ...snapshot(), history })).toThrow();
        }
    });
    it('does not mutate frozen source data', () => {
        const data = snapshot(); Object.freeze(data.customer); Object.freeze(data.actions[0]); Object.freeze(data);
        const before = JSON.stringify(data); parseLeadWorkSnapshot(data); expect(JSON.stringify(data)).toBe(before);
    });
});

describe('write result projection', () => {
    it('accepts only command-specific activity IDs and strips extra data', () => {
        const result = { nextActionId: ACTION, activityId: null, replayed: true };
        expect(parseLeadWorkResult({ ...result, privateDump: 'secret' }, 'set_next_action')).toEqual(result);
        expect(parseLeadWorkResult({ ...result, activityId: ACTIVITY }, 'record_attempt').activityId).toBe(ACTIVITY);
        expect(() => parseLeadWorkResult(result, 'record_attempt')).toThrow();
        expect(() => parseLeadWorkResult({ ...result, activityId: ACTIVITY }, 'set_next_action')).toThrow();
        expect(() => parseLeadWorkResult({ ...result, nextActionId: `${ACTION}\n` }, 'set_next_action')).toThrow();
    });
});
