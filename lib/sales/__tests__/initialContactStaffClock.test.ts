import { describe, expect, it, vi } from 'vitest';
import {
    calculateInitialContactStaffDeadline, type InitialContactStaffInput, type InitialContactStaffPolicy,
} from '../initialContactStaffClock';
import { prepareSlaWorkCalendar, type RawSlaWorkCalendar } from '../slaCalendar';
import type { SlaWorkCalendar, SlaWorkPeriod } from '../slaClock';

const policy: InitialContactStaffPolicy = { approval: 'approved', version: 'initial-contact-approved-v1', workingMinutes: 120 };
const period = (id: string, startsAt: string, endsAt: string): SlaWorkPeriod => ({ id, startsAt, endsAt });
const work = [
    period('day-one', '2026-09-14T09:00:00+07:00', '2026-09-14T18:00:00+07:00'),
    period('day-two', '2026-09-15T09:00:00+07:00', '2026-09-15T18:00:00+07:00'),
    period('day-three', '2026-09-16T09:00:00+07:00', '2026-09-16T18:00:00+07:00'),
];
function calendar(workPeriods: readonly SlaWorkPeriod[] = work): SlaWorkCalendar {
    return { id: 'roster', version: 'roster-v7', ownerUserId: 'sales-id', leaveAndBreaksSubtracted: true,
        coverage: { startsAt: '2026-09-14T00:00:00+07:00', endsAt: '2026-09-19T00:00:00+07:00', complete: true }, workPeriods };
}
function input(overrides: Partial<InitialContactStaffInput> = {}): InitialContactStaffInput {
    return { anchorAt: '2026-09-14T10:00:00.123456+07:00', serviceDueAt: '2026-09-15T10:00:00.123456+07:00',
        ownerUserId: 'sales-id', ownership: 'unchanged', calendar: calendar(), policy, ...overrides };
}
function calculate(value: unknown) { return calculateInitialContactStaffDeadline(value as InitialContactStaffInput); }
function prepared(exclusions: RawSlaWorkCalendar['periods']): SlaWorkCalendar {
    const result = prepareSlaWorkCalendar({ id: 'roster', version: 'roster-v7', ownerUserId: 'sales-id', coverage: calendar().coverage,
        periods: [...work.map(row => ({ ...row, salesUserId: 'sales-id', type: 'work' as const })), ...exclusions] });
    if (result.state !== 'ready') throw new Error('Invalid test calendar');
    return result.calendar;
}

describe('approved initial-contact in-hours service deadline', () => {
    it('preserves original24h elapsed service and in-work staff deadline byte-for-byte', () => {
        const value = input();
        expect(calculateInitialContactStaffDeadline(value)).toEqual({ state: 'ready', rule: 'service_deadline',
            anchorAt: value.anchorAt, ownerUserId: 'sales-id', serviceDueAt: value.serviceDueAt, staffDueAt: value.serviceDueAt,
            notifyAt: value.anchorAt, calendarId: 'roster', calendarVersion: 'roster-v7', policyVersion: policy.version, usedWorkPeriodIds: ['day-two'] });
    });
    it('does not silently recompute a supplied deadline, even for a different elapsed duration', () => {
        // Confirmed24h policy matching belongs to the trusted caller. This helper
        // consumes a stored deadline, never recalculates it from the lead anchor.
        const serviceDueAt = '2026-09-15T12:30:00.654321+07:00';
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt }))).toMatchObject({ state: 'ready', staffDueAt: serviceDueAt, serviceDueAt });
    });
    it('treats shift start as in-work, shift end as off-shift, without rounding one microsecond', () => {
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt: '2026-09-15T09:00:00+07:00' }))).toMatchObject({ rule: 'service_deadline', staffDueAt: '2026-09-15T09:00:00+07:00' });
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt: '2026-09-15T17:59:59.999999+07:00' }))).toMatchObject({ rule: 'service_deadline', staffDueAt: '2026-09-15T17:59:59.999999+07:00' });
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt: '2026-09-15T18:00:00+07:00' }))).toMatchObject({ rule: 'off_shift_service_deadline', staffDueAt: '2026-09-16T04:00:00.000000Z' });
    });
    it('anchor shift-start is in-hours and an equal stored deadline is not changed', () => {
        const anchorAt = '2026-09-14T09:00:00.000001+07:00';
        expect(calculateInitialContactStaffDeadline(input({ anchorAt, serviceDueAt: anchorAt }))).toMatchObject({ state: 'ready', rule: 'service_deadline', staffDueAt: anchorAt, notifyAt: anchorAt });
    });
    it('handles an adjacent period start as actual work, not a fictitious gap', () => {
        const roster = calendar([work[0], period('before', '2026-09-15T09:00:00+07:00', '2026-09-15T12:00:00+07:00'),
            period('after', '2026-09-15T12:00:00+07:00', '2026-09-15T18:00:00+07:00')]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster, serviceDueAt: '2026-09-15T12:00:00+07:00' })))
            .toMatchObject({ rule: 'service_deadline', staffDueAt: '2026-09-15T12:00:00+07:00', usedWorkPeriodIds: ['after'] });
    });
    it('uses actual overnight work without imposing office hours or weekdays', () => {
        const roster = calendar([period('night-one', '2026-09-14T20:00:00+07:00', '2026-09-15T04:00:00+07:00'),
            period('night-two', '2026-09-15T20:00:00+07:00', '2026-09-16T04:00:00+07:00')]);
        const anchorAt = '2026-09-14T22:15:00.123456+07:00', serviceDueAt = '2026-09-15T22:15:00.123456+07:00';
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster, anchorAt, serviceDueAt })))
            .toMatchObject({ state: 'ready', rule: 'service_deadline', staffDueAt: serviceDueAt, notifyAt: anchorAt, usedWorkPeriodIds: ['night-two'] });
    });
    it('compares equivalent offset timestamps by exact microseconds', () => {
        const serviceDueAt = '2026-09-15T02:00:00.000001Z';
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt }))).toMatchObject({ rule: 'service_deadline', serviceDueAt, staffDueAt: serviceDueAt });
    });
});

describe('in-hours lead with off-shift stored service deadline', () => {
    it('waits until next actual work after the service deadline, not after the lead anchor', () => {
        const serviceDueAt = '2026-09-15T20:00:00.123456+07:00';
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt }))).toEqual({ state: 'ready', rule: 'off_shift_service_deadline',
            anchorAt: input().anchorAt, ownerUserId: 'sales-id', serviceDueAt, staffDueAt: '2026-09-16T04:00:00.000000Z',
            notifyAt: input().anchorAt, calendarId: 'roster', calendarVersion: 'roster-v7', policyVersion: policy.version, usedWorkPeriodIds: ['day-three'] });
    });
    it('consumes prepared break exclusions and starts120workingminutes after that break', () => {
        const roster = prepared([{ id: 'approved-break', salesUserId: 'sales-id', type: 'break', startsAt: '2026-09-15T12:00:00+07:00', endsAt: '2026-09-15T13:00:00+07:00' }]);
        const serviceDueAt = '2026-09-15T12:30:00.123456+07:00';
        const result = calculateInitialContactStaffDeadline(input({ calendar: roster, serviceDueAt }));
        expect(result).toMatchObject({ rule: 'off_shift_service_deadline', serviceDueAt, staffDueAt: '2026-09-15T08:00:00.000000Z', notifyAt: input().anchorAt });
        expect(result).not.toHaveProperty('leaveReason');
    });
    it('consumes approved leave and uses the next actual day without resetting service', () => {
        const roster = prepared([{ id: 'leave', salesUserId: 'sales-id', type: 'leave', startsAt: '2026-09-15T00:00:00+07:00', endsAt: '2026-09-16T00:00:00+07:00' }]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster }))).toMatchObject({ rule: 'off_shift_service_deadline',
            serviceDueAt: input().serviceDueAt, staffDueAt: '2026-09-16T04:00:00.000000Z' });
    });
    it('accumulates120actual minutes across breaks and multiple future days', () => {
        const roster = calendar([work[0], period('short', '2026-09-15T13:00:00.123456+07:00', '2026-09-15T13:30:00.123456+07:00'),
            period('later', '2026-09-15T15:00:00.123456+07:00', '2026-09-15T16:00:00.123456+07:00'),
            period('next-day', '2026-09-17T08:00:00.123456+07:00', '2026-09-17T10:00:00.123456+07:00')]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster, serviceDueAt: '2026-09-15T10:00:00.123456+07:00' })))
            .toMatchObject({ rule: 'off_shift_service_deadline', staffDueAt: '2026-09-17T01:30:00.123456Z', usedWorkPeriodIds: ['short', 'later', 'next-day'] });
    });
    it('preserves fractional microsecond remainder across split periods', () => {
        const roster = calendar([work[0], period('one', '2026-09-15T13:00:00.000001+07:00', '2026-09-15T14:00:00.000000+07:00'),
            period('two', '2026-09-15T15:00:00.000001+07:00', '2026-09-15T18:00:00.000000+07:00')]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster }))).toMatchObject({ rule: 'off_shift_service_deadline', staffDueAt: '2026-09-15T09:00:00.000002Z' });
    });
    it('can finish exactly at a proven shift/coverage end', () => {
        const roster = calendar([work[0], period('complete', '2026-09-15T13:00:00+07:00', '2026-09-15T15:00:00+07:00')]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: { ...roster, coverage: { ...roster.coverage, endsAt: '2026-09-15T15:00:00+07:00' } } })))
            .toMatchObject({ rule: 'off_shift_service_deadline', staffDueAt: '2026-09-15T08:00:00.000000Z' });
    });
    it('requires enough future actual work and never rounds119m59.999999s up', () => {
        const roster = calendar([work[0], period('short', '2026-09-15T13:00:00+07:00', '2026-09-15T14:59:59.999999+07:00')]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster }))).toEqual({ state: 'not_ready', reason: 'INSUFFICIENT_WORKING_TIME' });
    });
    it('uses an explicit approved custom duration only, with no silent default', () => {
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt: '2026-09-15T20:00:00+07:00', policy: { ...policy, version: 'custom-approved', workingMinutes: 90 } })))
            .toMatchObject({ rule: 'off_shift_service_deadline', staffDueAt: '2026-09-16T03:30:00.000000Z', policyVersion: 'custom-approved' });
    });
});

describe('initial-contact out-of-hours anchor delegates existing rule', () => {
    const changes = { anchorAt: '2026-09-14T21:00:00.123456+07:00', serviceDueAt: '2026-09-15T21:00:00.123456+07:00' };
    it('uses next actual period120minutes, independent of when service clock expires', () => {
        expect(calculateInitialContactStaffDeadline(input(changes))).toEqual({ state: 'ready', rule: 'out_of_hours', ...changes,
            ownerUserId: 'sales-id', staffDueAt: '2026-09-15T04:00:00.000000Z', notifyAt: '2026-09-15T02:00:00.000000Z',
            calendarId: 'roster', calendarVersion: 'roster-v7', policyVersion: policy.version, usedWorkPeriodIds: ['day-two'] });
    });
    it('treats anchor shift end as out-of-hours, not in-hours', () => {
        expect(calculateInitialContactStaffDeadline(input({ ...changes, anchorAt: '2026-09-14T18:00:00+07:00' })))
            .toMatchObject({ rule: 'out_of_hours', notifyAt: '2026-09-15T02:00:00.000000Z', staffDueAt: '2026-09-15T04:00:00.000000Z' });
    });
    it('recognizes original anchor inside an approved break as out-of-hours', () => {
        const roster = prepared([{ id: 'break', salesUserId: 'sales-id', type: 'break', startsAt: '2026-09-14T09:30:00+07:00', endsAt: '2026-09-14T11:00:00+07:00' }]);
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster }))).toMatchObject({ rule: 'out_of_hours',
            serviceDueAt: input().serviceDueAt, notifyAt: '2026-09-14T04:00:00.000000Z', staffDueAt: '2026-09-14T06:00:00.000000Z' });
    });
    it('does not demand unrelated service-deadline coverage in this independent branch', () => {
        const roster = calendar([work[1]]);
        expect(calculateInitialContactStaffDeadline(input({ ...changes, calendar: { ...roster, coverage: { ...roster.coverage, endsAt: '2026-09-15T18:00:00+07:00' } } })))
            .toMatchObject({ rule: 'out_of_hours', serviceDueAt: changes.serviceDueAt, staffDueAt: '2026-09-15T04:00:00.000000Z' });
    });
    it('does not invent shifts for an empty complete calendar', () => {
        expect(calculateInitialContactStaffDeadline(input({ ...changes, calendar: calendar([]) }))).toEqual({ state: 'not_ready', reason: 'INSUFFICIENT_WORKING_TIME' });
    });
});

describe('initial-contact prerequisites and bounded prepared evidence', () => {
    it.each([['changed', 'OWNER_CHANGED'], ['unknown', 'OWNER_HISTORY_UNKNOWN'], [undefined, 'OWNER_HISTORY_UNKNOWN']])('keeps ownership %j held', (ownership, reason) => {
        expect(calculate({ ...input(), ownership })).toEqual({ state: 'needs_policy', reason });
    });
    it.each([null, undefined, ''])('requires explicit policy %j', value => {
        expect(calculate({ ...input(), policy: value })).toEqual({ state: 'needs_policy', reason: 'INITIAL_CONTACT_RULE_UNAPPROVED' });
    });
    it('does not infer policy approval from version or supported calendar', () => {
        expect(calculateInitialContactStaffDeadline(input({ policy: { ...policy, approval: 'unapproved' } }))).toEqual({ state: 'needs_policy', reason: 'INITIAL_CONTACT_RULE_UNAPPROVED' });
    });
    it.each([0, -1, 1.5, NaN, Infinity, '120', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects bad explicit workingMinutes %j even for direct in-hours deadlines', workingMinutes => {
        expect(calculate({ ...input(), policy: { ...policy, workingMinutes } })).toEqual({ state: 'needs_policy', reason: 'INVALID_STAFF_POLICY' });
    });
    it.each([{}, [], 1, { ...policy, approval: true }, { ...policy, version: ' ' }, { ...policy, version: '\ud800' },
        { ...policy, rule: 'guess' }, { ...policy, score: 1 }])('rejects unsupported or malformed policy %j', value => {
        expect(calculate({ ...input(), policy: value })).toEqual({ state: 'needs_policy', reason: 'INVALID_STAFF_POLICY' });
    });
    it.each([null, undefined, ''])('requires original anchor and stored service deadline %j', missing => {
        expect(calculate({ ...input(), anchorAt: missing })).toEqual({ state: 'not_ready', reason: 'MISSING_ANCHOR' });
        expect(calculate({ ...input(), serviceDueAt: missing })).toEqual({ state: 'not_ready', reason: 'MISSING_SERVICE_DEADLINE' });
    });
    it.each(['2026-02-29T10:00:00Z', '2026-04-31T10:00:00Z', '2026-09-14', '2026-09-14T10:00:00', '2026-09-14T24:00:00Z',
        '2026-09-14T10:00:60Z', '2026-09-14T10:00:00-00:00', '2026-09-14T10:00:00.1234567Z', '2026-09-14T10:00:00Z\n',
        '2026-09-14T10:00:00Z\u2028', 'infinity', 0])('rejects invalid/microsecond-losing timestamp %j', value => {
        expect(calculate({ ...input(), anchorAt: value })).toEqual({ state: 'not_ready', reason: 'INVALID_ANCHOR' });
        expect(calculate({ ...input(), serviceDueAt: value })).toEqual({ state: 'not_ready', reason: 'INVALID_SERVICE_DEADLINE' });
    });
    it.each(['0001-01-01T00:00:00+00:01', '9999-12-31T23:59:59-00:01'])('rejects timestamps mapping outside supported Gregorian range %s', value => {
        expect(calculate({ ...input(), anchorAt: value })).toEqual({ state: 'not_ready', reason: 'DATE_OUT_OF_RANGE' });
        expect(calculate({ ...input(), serviceDueAt: value })).toEqual({ state: 'not_ready', reason: 'DATE_OUT_OF_RANGE' });
    });
    it('requires service deadline not earlier than anchor at exact microsecond precision', () => {
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt: '2026-09-14T03:00:00.123455Z' })))
            .toEqual({ state: 'not_ready', reason: 'SERVICE_DEADLINE_BEFORE_ANCHOR' });
    });
    it.each([null, '', undefined])('requires owner %j', ownerUserId => {
        expect(calculate({ ...input(), ownerUserId })).toEqual({ state: 'not_ready', reason: 'MISSING_OWNER' });
    });
    it.each([' sales-id ', 'bad\u0000id', '\ud800', 'x'.repeat(201), 3])('rejects malformed owner %j', ownerUserId => {
        expect(calculate({ ...input(), ownerUserId })).toEqual({ state: 'not_ready', reason: 'INVALID_OWNER' });
    });
    it.each([null, [], {}, { ...input(), ownership: true }, { ...input(), assignedAt: '2026-09-15T00:00:00Z' },
        { ...input(), score: 100 }])('never guesses malformed or expanded input %j', value => {
        const result = calculate(value); expect(result.state).not.toBe('ready'); expect(result).not.toHaveProperty('staffDueAt'); expect(result).not.toHaveProperty('score');
    });
    it.each([
        [null, 'MISSING_CALENDAR'], [{ ...calendar(), leaveAndBreaksSubtracted: false }, 'EXCLUSIONS_NOT_APPLIED'],
        [{ ...calendar(), ownerUserId: 'different' }, 'CALENDAR_OWNER_MISMATCH'],
        [{ ...calendar(), coverage: { ...calendar().coverage, complete: false } }, 'INCOMPLETE_COVERAGE'],
        [{ ...calendar(), coverage: { ...calendar().coverage, startsAt: '2026-09-15T00:00:00+07:00' } }, 'ANCHOR_OUTSIDE_COVERAGE'],
        [{ ...calendar(), coverage: { ...calendar().coverage, endsAt: input().anchorAt } }, 'ANCHOR_OUTSIDE_COVERAGE'],
    ])('fails closed with unusable prepared calendar %j', (value, reason) => {
        expect(calculate({ ...input(), calendar: value })).toEqual({ state: 'not_ready', reason });
    });
    it.each(['2026-09-19T00:00:00+07:00', '2026-09-20T10:00:00+07:00'])('requires in-hours service deadline inside exclusive-end complete coverage %s', serviceDueAt => {
        expect(calculateInitialContactStaffDeadline(input({ serviceDueAt }))).toEqual({ state: 'not_ready', reason: 'SERVICE_DUE_OUTSIDE_COVERAGE' });
    });
    it.each([
        [], {}, { ...calendar(), id: '' }, { ...calendar(), version: '\ud800' }, { ...calendar(), workPeriods: null },
        { ...calendar(), coverage: null }, { ...calendar(), coverage: { ...calendar().coverage, endsAt: 'bad' } },
        { ...calendar(), workPeriods: [null] }, { ...calendar(), workPeriods: [{ ...work[0], secret: 'value' }] },
        { ...calendar(), secret: 'value' }, { ...calendar(), coverage: { ...calendar().coverage, secret: 'value' } },
    ])('rejects malformed and extra-field calendar %j', value => {
        expect(calculate({ ...input(), calendar: value })).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
    it.each([
        [work[0], { ...work[1], id: work[0].id }], [work[0], { ...work[0], id: 'duplicate-range' }],
        [period('backwards', '2026-09-14T18:00:00+07:00', '2026-09-14T09:00:00+07:00')],
        [period('zero', '2026-09-14T09:00:00+07:00', '2026-09-14T09:00:00+07:00')],
        [period('outside', '2026-09-13T09:00:00+07:00', '2026-09-14T18:00:00+07:00')],
        [period('outside', '2026-09-14T09:00:00+07:00', '2026-09-20T18:00:00+07:00')],
        [period('invalid', '2026-09-14T09:00:00', '2026-09-14T18:00:00+07:00')],
        [period('bad\u0000id', '2026-09-14T09:00:00+07:00', '2026-09-14T18:00:00+07:00')],
    ])('never silently repairs invalid work intervals %j', (...periods) => {
        expect(calculateInitialContactStaffDeadline(input({ calendar: calendar(periods) }))).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
    it('rejects more than10000work intervals before examining them', () => {
        expect(calculateInitialContactStaffDeadline(input({ calendar: calendar(Array.from({ length: 10001 }, () => work[0])) })))
            .toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
});

describe('exact Gregorian evidence, immutability and no external effects', () => {
    it.each([
        ['2024-02-28T10:00:00.123456Z', '2024-02-29T10:00:00.123456Z', '2024-02-28T00:00:00Z', '2024-03-01T00:00:00Z'],
        ['0001-01-01T00:00:00.000001Z', '0001-01-02T00:00:00.000001Z', '0001-01-01T00:00:00Z', '0001-01-03T00:00:00Z'],
        ['1969-12-29T23:59:59.999999Z', '1969-12-30T23:59:59.999999Z', '1969-12-29T00:00:00Z', '1969-12-31T00:00:00Z'],
    ])('keeps exact in-work timestamp through Gregorian boundary %s', (anchorAt, serviceDueAt, from, through) => {
        const roster = { ...calendar([period('continuous', from, through)]), coverage: { startsAt: from, endsAt: through, complete: true } };
        expect(calculateInitialContactStaffDeadline(input({ anchorAt, serviceDueAt, calendar: roster })))
            .toMatchObject({ state: 'ready', rule: 'service_deadline', anchorAt, serviceDueAt, staffDueAt: serviceDueAt, notifyAt: anchorAt });
    });
    it('retains negative-epoch fractional microseconds in a deferred next-work calculation', () => {
        const roster = { ...calendar([
            period('anchor', '1969-12-29T08:00:00Z', '1969-12-29T12:00:00Z'),
            period('next', '1969-12-30T13:00:00.123456Z', '1969-12-30T17:00:00.123456Z'),
        ]), coverage: { startsAt: '1969-12-29T00:00:00Z', endsAt: '1969-12-31T00:00:00Z', complete: true } };
        expect(calculateInitialContactStaffDeadline(input({ calendar: roster, anchorAt: '1969-12-29T09:00:00.123456Z', serviceDueAt: '1969-12-30T09:00:00.123456Z' })))
            .toMatchObject({ rule: 'off_shift_service_deadline', staffDueAt: '1969-12-30T15:00:00.123456Z' });
    });
    it('sorts only private copies and leaves frozen source, deadline, policy and roster untouched', () => {
        const roster = calendar(Object.freeze([...work].reverse().map(row => Object.freeze({ ...row }))));
        Object.freeze(roster.coverage); Object.freeze(roster);
        const value = Object.freeze(input({ calendar: roster, policy: Object.freeze({ ...policy }), serviceDueAt: '2026-09-15T20:00:00.123456+07:00' }));
        const before = JSON.stringify(value), result = calculateInitialContactStaffDeadline(value);
        expect(result).toMatchObject({ state: 'ready', serviceDueAt: value.serviceDueAt, usedWorkPeriodIds: ['day-three'] });
        expect(JSON.stringify(value)).toBe(before); expect(calculateInitialContactStaffDeadline(value)).toEqual(result);
    });
    it('does not depend on wall-clock time or emit notification/task/KPI state', () => {
        const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No wall clock allowed'); });
        try {
            const result = calculateInitialContactStaffDeadline(input()); expect(result.state).toBe('ready');
            for (const field of ['notification', 'dedupeKey', 'readAt', 'score', 'overdue', 'status', 'completedAt']) expect(result).not.toHaveProperty(field);
            expect(now).not.toHaveBeenCalled();
        } finally { now.mockRestore(); }
    });
});
