import { describe, expect, it } from 'vitest';
import { prepareSlaWorkCalendar } from '../slaCalendar';
import type { SlaWorkCalendar } from '../slaClock';
import { planInAppSlaReminder, type InAppSlaReminderInput, type SlaReminderAccountability, type SlaReminderTask } from '../slaReminder';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const taskId = '22222222-2222-4222-8222-222222222222';
const revision = '33333333-3333-4333-8333-333333333333';
const nextRevision = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const calendarId = 'trusted-roster', calendarVersion = 'roster-v5';
const time = (clock: string, date = '2026-09-15') => `${date}T${clock}+07:00`;
function calendar(): SlaWorkCalendar {
    const result = prepareSlaWorkCalendar({ id: calendarId, version: calendarVersion, ownerUserId: owner,
        coverage: { startsAt: time('00:00:00'), endsAt: time('00:00:00', '2026-09-18'), complete: true },
        periods: [
            { id: 'day-one', salesUserId: owner, type: 'work', startsAt: time('09:00:00'), endsAt: time('18:00:00') },
            { id: 'break', salesUserId: owner, type: 'break', startsAt: time('12:00:00'), endsAt: time('13:00:00') },
            { id: 'day-two', salesUserId: owner, type: 'work', startsAt: time('09:00:00', '2026-09-16'), endsAt: time('18:00:00', '2026-09-16') },
            { id: 'whole-day-leave', salesUserId: owner, type: 'leave', startsAt: time('00:00:00', '2026-09-16'), endsAt: time('00:00:00', '2026-09-17') },
            { id: 'day-three', salesUserId: owner, type: 'work', startsAt: time('10:00:00', '2026-09-17'), endsAt: time('18:00:00', '2026-09-17') },
        ] });
    if (result.state !== 'ready') throw new Error('Invalid test calendar');
    return result.calendar;
}
function accountability(changes: Partial<SlaReminderAccountability> = {}): SlaReminderAccountability {
    return { state: 'ready', ownerUserId: owner, lifecycleRevision: revision, calendarId, calendarVersion,
        staffDueAt: time('11:00:00'), notifyAt: time('09:00:00'), lifecycleReview: 'clear', ...changes };
}
function task(changes: Partial<SlaReminderTask> = {}): SlaReminderTask {
    return { id: taskId, ownerUserId: owner, ownerActive: true, lifecycleRevision: revision, status: 'open', scopeClosed: false,
        serviceDueAt: time('08:00:00'), accountability: accountability(), ...changes };
}
function input(changes: Partial<InAppSlaReminderInput> = {}): InAppSlaReminderInput {
    return { task: task(), asOf: time('10:45:00'), calendar: calendar(), policy: { version: 'approved-notice-v1', dueSoonMinutes: 30 }, ...changes };
}
function candidate(value = input()) {
    const result = planInAppSlaReminder(value);
    if (result.state !== 'ready') throw new Error(`Expected ready reminder, received ${result.state}/${result.reason}`);
    return result.candidate;
}
const unsafe = (value: unknown) => value as InAppSlaReminderInput;

describe('pure in-app staff deadline candidate', () => {
    it('uses staff due, preserving service due as context without a score or personal text', () => {
        expect(candidate()).toEqual({ channel: 'in_app', taskId, recipientUserId: owner, lifecycleRevision: revision,
            notificationType: 'due_soon', dedupeKey: expect.any(String), availableAt: '2026-09-15T03:30:00.000000Z',
            staffDueAt: '2026-09-15T04:00:00.000000Z', serviceDueAt: '2026-09-15T01:00:00.000000Z',
            calendarId, calendarVersion, policyVersion: 'approved-notice-v1' });
        // Service is already overdue, but the staff deadline is not: never label staff late from service time.
        expect(candidate().notificationType).toBe('due_soon');
        expect(Object.keys(candidate())).not.toEqual(expect.arrayContaining(['score', 'message', 'customerName', 'leaveReason', 'readAt']));
    });
    it.each([
        ['10:29:59.999999', { state: 'none', reason: 'NOT_DUE_SOON' }],
        ['10:30:00.000000', 'due_soon'], ['11:00:00.000000', 'due_soon'], ['11:00:00.000001', 'overdue'],
    ])('classifies exact microsecond boundary %s', (clock, expected) => {
        const result = planInAppSlaReminder(input({ asOf: time(clock) }));
        if (typeof expected === 'string') expect(result).toMatchObject({ state: 'ready', candidate: { notificationType: expected } });
        else expect(result).toEqual(expected);
    });
    it('computes a stable first eligible instant, never a polling timestamp', () => {
        const one = candidate(input({ asOf: time('11:00:00.000001') }));
        const later = candidate(input({ asOf: time('11:59:59.999999') }));
        const nextWorkingDay = candidate(input({ asOf: time('10:00:00', '2026-09-17') }));
        expect(one.availableAt).toBe('2026-09-15T04:00:00.000001Z');
        expect(later).toEqual(one);
        expect(nextWorkingDay).toEqual(one);
    });
    it('delays eligibility until notifyAt even when already in the due-soon window', () => {
        const current = task({ accountability: accountability({ notifyAt: time('10:40:00') }) });
        expect(planInAppSlaReminder(input({ task: current, asOf: time('10:35:00') }))).toEqual({ state: 'none', reason: 'NOT_YET_AVAILABLE' });
        expect(candidate(input({ task: current, asOf: time('10:40:00') })).availableAt).toBe('2026-09-15T03:40:00.000000Z');
    });
    it.each(['08:59:59.999999', '12:00:00', '12:59:59.999999', '18:00:00', '23:00:00'])('does not send outside actual work or during a break at %s', clock => {
        expect(planInAppSlaReminder(input({ asOf: time(clock) }))).toEqual({ state: 'none', reason: 'OUTSIDE_WORKING_HOURS' });
    });
    it('does not notify during approved whole-day leave or fabricate a next-day 09:00 shift', () => {
        expect(planInAppSlaReminder(input({ asOf: time('11:00:00', '2026-09-16') }))).toEqual({ state: 'none', reason: 'OUTSIDE_WORKING_HOURS' });
        expect(planInAppSlaReminder(input({ asOf: time('09:00:00', '2026-09-17') }))).toEqual({ state: 'none', reason: 'OUTSIDE_WORKING_HOURS' });
        expect(candidate(input({ asOf: time('10:00:00', '2026-09-17') })).notificationType).toBe('overdue');
    });
    it('moves first availability to the next actual work interval when threshold is inside a break', () => {
        const current = task({ accountability: accountability({ staffDueAt: time('13:10:00') }) });
        expect(candidate(input({ task: current, asOf: time('13:00:00') })).availableAt).toBe('2026-09-15T06:00:00.000000Z');
        const atShiftEnd = task({ accountability: accountability({ staffDueAt: time('12:00:00') }) });
        expect(candidate(input({ task: atShiftEnd, asOf: time('13:00:00') })).availableAt).toBe('2026-09-15T06:00:00.000000Z');
    });
    it('supports explicit zero-minute lead time without inventing a configured default', () => {
        const policy = { version: 'at-due-only', dueSoonMinutes: 0 };
        expect(planInAppSlaReminder(input({ policy, asOf: time('10:59:59.999999') }))).toEqual({ state: 'none', reason: 'NOT_DUE_SOON' });
        expect(candidate(input({ policy, asOf: time('11:00:00') })).notificationType).toBe('due_soon');
        expect(candidate(input({ policy, asOf: time('11:00:00.000001') })).notificationType).toBe('overdue');
    });
    it('does not use the machine clock or modify a frozen projection', () => {
        const value = input();
        Object.freeze(value.task!.accountability); Object.freeze(value.task); Object.freeze(value.policy);
        value.calendar!.workPeriods.forEach(Object.freeze); Object.freeze(value.calendar!.workPeriods);
        Object.freeze(value.calendar!.coverage); Object.freeze(value.calendar); Object.freeze(value);
        const before = JSON.stringify(value);
        expect(candidate(value)).toEqual(candidate(value));
        expect(JSON.stringify(value)).toBe(before);
    });
});

describe('dedupe and lifecycle invalidation contract', () => {
    it('deduplicates repeated polls and equivalent timestamp offsets while separating reminder kinds', () => {
        const first = candidate(input({ asOf: time('10:30:00') }));
        expect(candidate(input({ asOf: time('10:59:59.999999') })).dedupeKey).toBe(first.dedupeKey);
        expect(candidate(input({ task: task({ accountability: accountability({ staffDueAt: '2026-09-15T04:00:00Z' }) }) })).dedupeKey).toBe(first.dedupeKey);
        expect(candidate(input({ asOf: time('11:00:00.000001') })).dedupeKey).not.toBe(first.dedupeKey);
    });
    it('changes dedupe identity for each task, owner, revision, exact deadline or explicit policy', () => {
        const original = candidate().dedupeKey;
        const changedOwner = task({ ownerUserId: otherOwner, lifecycleRevision: nextRevision,
            accountability: accountability({ ownerUserId: otherOwner, lifecycleRevision: nextRevision }) });
        const values = [
            input({ task: task({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) }),
            input({ task: changedOwner, calendar: { ...calendar(), ownerUserId: otherOwner } }),
            input({ task: task({ lifecycleRevision: nextRevision, accountability: accountability({ lifecycleRevision: nextRevision }) }) }),
            input({ task: task({ accountability: accountability({ staffDueAt: time('11:00:00.000001') }) }) }),
            input({ policy: { version: 'approved-notice-v2', dueSoonMinutes: 30 } }),
            input({ policy: { version: 'approved-notice-v1', dueSoonMinutes: 20 } }),
        ];
        const keys = values.map(value => candidate(value).dedupeKey);
        expect(keys.every(key => key !== original)).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
    });
    it('keeps a bounded unambiguous tuple even with delimiters and escaped characters in a policy ID', () => {
        const version = ':"'.repeat(100);
        const value = candidate(input({ policy: { version, dueSoonMinutes: 30 } }));
        expect(value.dedupeKey.length).toBeLessThan(1024);
        const tuple = JSON.parse(value.dedupeKey.slice('sla_reminder_v1:'.length));
        expect(tuple).toEqual([taskId, owner, revision, 'due_soon', value.staffDueAt, version, 30]);
    });
    it('canonicalizes UUID casing without giving a returning owner the old lifecycle dedupe identity', () => {
        const current = task({ ownerUserId: otherOwner, lifecycleRevision: nextRevision,
            accountability: accountability({ ownerUserId: otherOwner, lifecycleRevision: nextRevision }) });
        const value = input({ task: current, calendar: { ...calendar(), ownerUserId: otherOwner } });
        const changedCase = input({ task: { ...current, ownerUserId: otherOwner.toUpperCase(), lifecycleRevision: nextRevision.toUpperCase(),
            accountability: { ...current.accountability!, ownerUserId: otherOwner.toUpperCase(), lifecycleRevision: nextRevision.toUpperCase() } },
            calendar: { ...calendar(), ownerUserId: otherOwner.toUpperCase() } });
        expect(candidate(value)).toEqual(candidate(changedCase));
        const returnedOwner = task({ lifecycleRevision: nextRevision, accountability: accountability({ lifecycleRevision: nextRevision }) });
        expect(candidate(input({ task: returnedOwner })).dedupeKey).not.toBe(candidate().dedupeKey);
    });
    it.each(['done', 'cancelled'] as const)('stops candidate planning when the current task is %s', status => {
        expect(planInAppSlaReminder(input({ task: task({ status }) }))).toEqual({ state: 'none', reason: 'TASK_CLOSED' });
    });
    it('stops for a closed scope and owner-change review; it does not revive old withdrawn notifications', () => {
        expect(planInAppSlaReminder(input({ task: task({ scopeClosed: true }) }))).toEqual({ state: 'none', reason: 'TASK_CLOSED' });
        expect(planInAppSlaReminder(input({ task: task({ accountability: accountability({ lifecycleReview: 'owner_change_pending_review' }) }) })))
            .toEqual({ state: 'not_ready', reason: 'OWNER_CHANGE_PENDING_REVIEW' });
        // SQL 05 withdraws stored notices. The planner has no stored-notice input,
        // read receipt or ability to unwithdraw; worker/read paths must recheck it.
        expect(planInAppSlaReminder(unsafe({ ...input(), withdrawnAt: null, readAt: null }))).toEqual({ state: 'not_ready', reason: 'INVALID_INPUT' });
    });
    it.each([
        { ownerUserId: otherOwner }, { lifecycleRevision: nextRevision }, { calendarId: 'other-calendar' }, { calendarVersion: 'old-roster' },
    ])('rejects stale accountability %j', changes => {
        expect(planInAppSlaReminder(input({ task: task({ accountability: accountability(changes) }) }))).toEqual({ state: 'not_ready', reason: 'STALE_ACCOUNTABILITY' });
    });
    it.each(['needs_schedule', 'needs_owner', 'exception'] as const)('does not treat %s as an approved staff due date', state => {
        expect(planInAppSlaReminder(input({ task: task({ accountability: accountability({ state }) }) }))).toEqual({ state: 'not_ready', reason: 'ACCOUNTABILITY_NOT_READY' });
    });
});

describe('unready or malformed reminder evidence', () => {
    it.each([null, [], {}, { ...input(), email: 'not-supported' }])('rejects malformed input %j', value => {
        expect(planInAppSlaReminder(unsafe(value)).state).toBe('not_ready');
    });
    it.each([
        [{ task: null }, 'MISSING_TASK'], [{ policy: null }, 'MISSING_POLICY'], [{ calendar: null }, 'MISSING_CALENDAR'],
        [{ task: task({ ownerUserId: null }) }, 'MISSING_OWNER'], [{ task: task({ ownerActive: false }) }, 'INACTIVE_OWNER'],
        [{ task: task({ accountability: null }) }, 'ACCOUNTABILITY_NOT_READY'],
        [{ calendar: { ...calendar(), ownerUserId: otherOwner } }, 'CALENDAR_OWNER_MISMATCH'],
        [{ asOf: time('23:59:59.999999', '2026-09-14') }, 'AS_OF_OUTSIDE_COVERAGE'],
        [{ asOf: time('00:00:00', '2026-09-18') }, 'AS_OF_OUTSIDE_COVERAGE'],
    ])('fails closed without blame %j', (changes, reason) => {
        expect(planInAppSlaReminder(input(changes as Partial<InAppSlaReminderInput>))).toEqual({ state: 'not_ready', reason });
    });
    it.each(['2026-02-29T09:00:00Z', '2026-09-15', '2026-09-15T09:00:00', '2026-09-15T24:00:00Z',
        '2026-09-15T09:00:60Z', '2026-09-15T09:00:00-00:00', '2026-09-15T09:00:00.1234567Z',
        '2026-09-15T09:00:00Z\n', '0001-01-01T00:00:00+01:00', '9999-12-31T23:59:59-01:00', null, 0,
    ])('rejects malformed times without silent rounding %j', value => {
        expect(planInAppSlaReminder(unsafe({ ...input(), asOf: value }))).toEqual({ state: 'not_ready', reason: 'INVALID_AS_OF' });
        expect(planInAppSlaReminder(unsafe({ ...input(), task: { ...task(), serviceDueAt: value } }))).toEqual({ state: 'not_ready', reason: 'INVALID_TASK' });
        for (const field of ['staffDueAt', 'notifyAt']) {
            expect(planInAppSlaReminder(unsafe({ ...input(), task: { ...task(), accountability: { ...accountability(), [field]: value } } })))
                .toEqual({ state: 'not_ready', reason: 'INVALID_ACCOUNTABILITY' });
        }
    });
    it.each([-1, 0.5, NaN, Infinity, '30', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects nonexplicit or invalid lead minutes %j', dueSoonMinutes => {
        expect(planInAppSlaReminder(unsafe({ ...input(), policy: { version: 'p', dueSoonMinutes } }))).toEqual({ state: 'not_ready', reason: 'INVALID_POLICY' });
    });
    it.each([{}, [], { version: '', dueSoonMinutes: 30 }, { version: 'bad\nversion', dueSoonMinutes: 30 },
        { version: 'x'.repeat(201), dueSoonMinutes: 30 }, { version: 'p', dueSoonMinutes: 30, email: true },
    ])('rejects malformed/private policy %j', policy => {
        expect(planInAppSlaReminder(unsafe({ ...input(), policy }))).toEqual({ state: 'not_ready', reason: 'INVALID_POLICY' });
    });
    it.each([
        { ...task(), id: 'not-uuid' }, { ...task(), ownerUserId: `${owner}\n` }, { ...task(), lifecycleRevision: 'r1' },
        { ...task(), ownerActive: 'true' }, { ...task(), scopeClosed: null }, { ...task(), status: 'lost' }, { ...task(), name: 'private customer' },
    ])('rejects malformed/private task %j', value => {
        expect(planInAppSlaReminder(unsafe({ ...input(), task: value }))).toEqual({ state: 'not_ready', reason: 'INVALID_TASK' });
    });
    it.each([
        { ...accountability(), state: 'guessed' }, { ...accountability(), lifecycleReview: undefined },
        { ...accountability(), ownerUserId: null }, { ...accountability(), lifecycleRevision: null },
        { ...accountability(), calendarId: '' }, { ...accountability(), calendarVersion: null },
        { ...accountability(), staffDueAt: null }, { ...accountability(), notifyAt: null },
        { ...accountability(), notifyAt: time('11:00:00.000001') },
        { ...accountability(), notifyAt: time('23:59:59', '2026-09-14') },
        { ...accountability(), staffDueAt: time('00:00:00.000001', '2026-09-18') },
        { ...accountability(), leaveReason: 'private medical details' },
    ])('rejects missing, contradictory or private accountability %j', value => {
        expect(planInAppSlaReminder(unsafe({ ...input(), task: { ...task(), accountability: value } }))).toEqual({ state: 'not_ready', reason: 'INVALID_ACCOUNTABILITY' });
    });
    it.each([
        { ...calendar(), leaveAndBreaksSubtracted: false }, { ...calendar(), leaveAndBreaksSubtracted: 'true' },
        { ...calendar(), coverage: { ...calendar().coverage, complete: false } },
        { ...calendar(), workPeriods: null }, { ...calendar(), hrNotes: 'private' },
        { ...calendar(), workPeriods: [{ ...calendar().workPeriods[0], reason: 'private' }] },
        { ...calendar(), workPeriods: [calendar().workPeriods[0], calendar().workPeriods[0]] },
        { ...calendar(), workPeriods: [calendar().workPeriods[0], { ...calendar().workPeriods[0], id: 'overlapping' }] },
        { ...calendar(), workPeriods: [{ ...calendar().workPeriods[0], startsAt: time('00:00:00', '2026-09-14') }] },
        { ...calendar(), workPeriods: [{ ...calendar().workPeriods[0], startsAt: 'invalid-time' }] },
    ])('requires a valid complete prepared calendar %j', value => {
        expect(planInAppSlaReminder(unsafe({ ...input(), calendar: value }))).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
    it('returns none for a proven calendar with no available work, without inventing a notice or deadline', () => {
        expect(planInAppSlaReminder(input({ calendar: { ...calendar(), workPeriods: [] } }))).toEqual({ state: 'none', reason: 'OUTSIDE_WORKING_HOURS' });
    });
});
