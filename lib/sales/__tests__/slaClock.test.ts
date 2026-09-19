import { describe, expect, it } from 'vitest';
import {
    calculateOutOfHoursStaffDeadline, calculateServiceDeadline, DEFAULT_OUT_OF_HOURS_WORKING_MINUTES,
    DEFAULT_SERVICE_SLA_POLICY, type OutOfHoursStaffInput, type OutOfHoursStaffPolicy,
    type ServiceDeadlineInput, type ServiceSlaPolicy, type SlaWorkCalendar, type SlaWorkPeriod,
} from '../slaClock';

const originalLead = { kind: 'first_contact' as const, leadId: 'lead-original', originalLeadAt: '2026-09-14T21:00:00.123456+07:00' };
const approvedPolicy: OutOfHoursStaffPolicy = { rule: 'next_actual_work_period', approval: 'approved', version: 'approved-example-v1', workingMinutes: 120 };
const period = (id: string, startsAt: string, endsAt: string): SlaWorkPeriod => ({ id, startsAt, endsAt });
function calendar(workPeriods: readonly SlaWorkPeriod[] = [
    period('morning', '2026-09-15T09:00:00+07:00', '2026-09-15T12:00:00+07:00'),
    period('afternoon', '2026-09-15T13:00:00+07:00', '2026-09-15T18:00:00+07:00'),
]): SlaWorkCalendar {
    return { id: 'calendar-evidence', version: 'roster-v3', ownerUserId: 'sales-id', leaveAndBreaksSubtracted: true,
        coverage: { startsAt: '2026-09-14T00:00:00+07:00', endsAt: '2026-09-18T00:00:00+07:00', complete: true }, workPeriods };
}
function staffInput(overrides: Partial<OutOfHoursStaffInput> = {}): OutOfHoursStaffInput {
    return { anchorAt: originalLead.originalLeadAt, ownerUserId: 'sales-id', ownership: 'unchanged', policy: approvedPolicy, calendar: calendar(), ...overrides };
}

describe('pure service clock', () => {
    it('defaults to exactly 24/48/24 elapsed hours, independently of calendar days', () => {
        expect(DEFAULT_SERVICE_SLA_POLICY).toEqual({ version: 'service_sla_v1', firstContactHours: 24, followUpHours: 48, hotPostVisitHours: 24 });
        expect(Object.isFrozen(DEFAULT_SERVICE_SLA_POLICY)).toBe(true);
        expect(calculateServiceDeadline(originalLead)).toEqual({ state: 'ready', kind: 'first_contact', sourceId: 'lead-original',
            anchorAt: originalLead.originalLeadAt, serviceDueAt: '2026-09-15T14:00:00.123456Z', durationHours: 24, policyVersion: 'service_sla_v1' });
        expect(calculateServiceDeadline({ kind: 'follow_up', qualifyingActivity: { id: 'already-qualified-source', occurredAt: '2026-09-14T23:59:59.999999+07:00' } }))
            .toMatchObject({ state: 'ready', serviceDueAt: '2026-09-16T16:59:59.999999Z', durationHours: 48, sourceId: 'already-qualified-source' });
        expect(calculateServiceDeadline({ kind: 'hot_post_visit', actualVisit: { id: 'real-visit', departedAt: '2026-09-14T15:45:00.000001+07:00' } }))
            .toMatchObject({ state: 'ready', serviceDueAt: '2026-09-15T08:45:00.000001Z', durationHours: 24, sourceId: 'real-visit' });
    });
    it('uses custom validated policy durations without mutating the confirmed default', () => {
        const policy = { version: 'configured-v2', firstContactHours: 12, followUpHours: 36, hotPostVisitHours: 18 };
        expect(calculateServiceDeadline(originalLead, policy)).toMatchObject({ serviceDueAt: '2026-09-15T02:00:00.123456Z', durationHours: 12, policyVersion: 'configured-v2' });
        expect(calculateServiceDeadline({ kind: 'follow_up', qualifyingActivity: { id: 'a', occurredAt: originalLead.originalLeadAt } }, policy)).toMatchObject({ durationHours: 36 });
        expect(calculateServiceDeadline({ kind: 'hot_post_visit', actualVisit: { id: 'v', departedAt: originalLead.originalLeadAt } }, policy)).toMatchObject({ durationHours: 18 });
        expect(DEFAULT_SERVICE_SLA_POLICY.firstContactHours).toBe(24);
    });
    it.each([
        { kind: 'first_contact', leadId: 'legacy-lead', originalLeadAt: null },
        { kind: 'first_contact', leadId: 'legacy-lead' },
        { kind: 'follow_up', qualifyingActivity: { id: 'historical-activity', occurredAt: null } },
        { kind: 'hot_post_visit', actualVisit: { id: 'historical-visit', departedAt: null } },
    ])('does not invent missing source time: %j', value => {
        expect(calculateServiceDeadline(value as ServiceDeadlineInput)).toEqual({ state: 'needs_evidence', reason: 'MISSING_ANCHOR' });
    });
    it.each([
        { kind: 'follow_up', qualifyingActivity: null }, { kind: 'follow_up' },
        { kind: 'hot_post_visit', actualVisit: null }, { kind: 'hot_post_visit' },
    ])('keeps absent event evidence unknown: %j', value => {
        expect(calculateServiceDeadline(value as ServiceDeadlineInput)).toEqual({ state: 'needs_evidence', reason: 'MISSING_SOURCE' });
    });
    it.each([null, '', undefined])('requires a stable source ID %j', leadId => {
        expect(calculateServiceDeadline({ ...originalLead, leadId } as ServiceDeadlineInput)).toEqual({ state: 'needs_evidence', reason: 'MISSING_SOURCE_ID' });
    });
    it.each([' lead ', 'bad\u0000id', '\ud800', 23])('rejects malformed source ID %j', leadId => {
        expect(calculateServiceDeadline({ ...originalLead, leadId } as unknown as ServiceDeadlineInput)).toEqual({ state: 'invalid', reason: 'INVALID_SOURCE_ID' });
    });
    it.each(['2026-02-29T09:00:00Z', '2026-04-31T09:00:00Z', '2026-09-14', '2026-09-14T09:00:00',
        '2026-09-14T24:00:00Z', '2026-09-14T09:00:60Z', '2026-09-14T09:00:00-00:00', '2026-09-14T09:00:00.1234567Z',
        '2026-09-14T09:00:00Z\n', '2026-09-14T09:00:00Z\u2028', 'infinity', 0])('fails closed on invalid source timestamp %j', originalLeadAt => {
        expect(calculateServiceDeadline({ ...originalLead, originalLeadAt } as unknown as ServiceDeadlineInput)).toEqual({ state: 'invalid', reason: 'INVALID_ANCHOR' });
    });
    it.each([0, -1, 1.5, NaN, Infinity, '24', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects invalid configurable duration %j', hours => {
        for (const key of ['firstContactHours', 'followUpHours', 'hotPostVisitHours']) {
            expect(calculateServiceDeadline(originalLead, { ...DEFAULT_SERVICE_SLA_POLICY, [key]: hours } as unknown as ServiceSlaPolicy))
                .toEqual({ state: 'invalid', reason: 'INVALID_POLICY' });
        }
    });
    it.each([null, {}, { ...DEFAULT_SERVICE_SLA_POLICY, version: '' }, { ...DEFAULT_SERVICE_SLA_POLICY, score: 100 }])('rejects malformed/extra policy %j', policy => {
        expect(calculateServiceDeadline(originalLead, policy as unknown as ServiceSlaPolicy)).toEqual({ state: 'invalid', reason: 'INVALID_POLICY' });
    });
    it('never substitutes booking, QR, recording or assignment times or classifies raw no-answer activity', () => {
        for (const value of [
            { ...originalLead, recordedAt: '2026-09-16T10:00:00Z' },
            { ...originalLead, ownerAssignedAt: '2026-09-16T10:00:00Z' },
            { kind: 'follow_up', activity: { id: 'a', result: 'no_answer', occurredAt: '2026-09-16T10:00:00Z' } },
            { kind: 'follow_up', qualifyingActivity: { id: 'a', occurredAt: '2026-09-16T10:00:00Z', result: 'no_answer' } },
            { kind: 'hot_post_visit', actualVisit: { id: 'v', departedAt: null, cvSubmittedAt: '2026-09-16T10:00:00Z' } },
        ]) expect(calculateServiceDeadline(value as ServiceDeadlineInput)).toEqual({ state: 'invalid', reason: 'INVALID_INPUT' });
    });
    it.each([null, [], {}, { kind: 'unknown' }, { kind: 'follow_up', qualifyingActivity: [] }])('rejects malformed source %j', input => {
        expect(calculateServiceDeadline(input as unknown as ServiceDeadlineInput)).toEqual({ state: 'invalid', reason: 'INVALID_INPUT' });
    });
    it('handles leap days, early Gregorian dates and negative epoch fractional microseconds exactly', () => {
        expect(calculateServiceDeadline({ ...originalLead, originalLeadAt: '2024-02-28T10:00:00.123456Z' })).toMatchObject({ serviceDueAt: '2024-02-29T10:00:00.123456Z' });
        expect(calculateServiceDeadline({ ...originalLead, originalLeadAt: '0001-01-01T00:00:00.000001Z' })).toMatchObject({ serviceDueAt: '0001-01-02T00:00:00.000001Z' });
        expect(calculateServiceDeadline({ ...originalLead, originalLeadAt: '1969-12-29T23:59:59.999999Z' })).toMatchObject({ serviceDueAt: '1969-12-30T23:59:59.999999Z' });
    });
    it('does not overflow or silently wrap an out-of-range deadline', () => {
        expect(calculateServiceDeadline({ ...originalLead, originalLeadAt: '9999-12-31T23:59:59.999999Z' })).toEqual({ state: 'invalid', reason: 'DATE_OUT_OF_RANGE' });
        expect(calculateServiceDeadline(originalLead, { ...DEFAULT_SERVICE_SLA_POLICY, firstContactHours: Number.MAX_SAFE_INTEGER })).toEqual({ state: 'invalid', reason: 'DATE_OUT_OF_RANGE' });
    });
});

describe('explicitly approved out-of-hours staff clock', () => {
    it('uses the next actual shift plus two working hours; service stays elapsed and unchanged', () => {
        const serviceBefore = calculateServiceDeadline(originalLead);
        expect(DEFAULT_OUT_OF_HOURS_WORKING_MINUTES).toBe(120);
        expect(calculateOutOfHoursStaffDeadline(staffInput())).toEqual({ state: 'ready', anchorAt: originalLead.originalLeadAt,
            ownerUserId: 'sales-id', workStartsAt: '2026-09-15T02:00:00.000000Z', staffDueAt: '2026-09-15T04:00:00.000000Z',
            workingMinutes: 120, policyVersion: 'approved-example-v1', calendarId: 'calendar-evidence', calendarVersion: 'roster-v3', usedWorkPeriodIds: ['morning'] });
        expect(calculateOutOfHoursStaffDeadline(staffInput({ ownership: 'changed' }))).toEqual({ state: 'needs_policy', reason: 'OWNER_CHANGED' });
        expect(calculateServiceDeadline(originalLead)).toEqual(serviceBefore);
        expect(serviceBefore).toMatchObject({ serviceDueAt: '2026-09-15T14:00:00.123456Z' });
    });
    it('accumulates only supplied work time across breaks, leave and another date', () => {
        const roster = calendar([
            period('short-shift', '2026-09-15T09:00:00.123456+07:00', '2026-09-15T09:30:00.123456+07:00'),
            period('after-break', '2026-09-15T13:00:00.123456+07:00', '2026-09-15T14:00:00.123456+07:00'),
            period('after-leave', '2026-09-17T08:00:00.123456+07:00', '2026-09-17T10:00:00.123456+07:00'),
        ]);
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: roster }))).toMatchObject({ state: 'ready',
            workStartsAt: '2026-09-15T02:00:00.123456Z', staffDueAt: '2026-09-17T01:30:00.123456Z', usedWorkPeriodIds: ['short-shift', 'after-break', 'after-leave'] });
    });
    it('preserves a fractional microsecond remainder across a split interval', () => {
        const roster = calendar([
            period('one', '2026-09-15T09:00:00.000001+07:00', '2026-09-15T10:00:00.000000+07:00'),
            period('two', '2026-09-15T11:00:00.000001+07:00', '2026-09-15T13:00:00.000000+07:00'),
        ]);
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: roster }))).toMatchObject({ staffDueAt: '2026-09-15T05:00:00.000002Z' });
    });
    it('uses supplied night/weekend shifts without inventing a 09:00 start or weekday filter', () => {
        const roster = calendar([period('actual-night', '2026-09-14T22:15:00+07:00', '2026-09-15T04:00:00+07:00')]);
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: roster }))).toMatchObject({
            workStartsAt: '2026-09-14T15:15:00.000000Z', staffDueAt: '2026-09-14T17:15:00.000000Z' });
    });
    it('accepts a validated approved custom working-minute duration', () => {
        expect(calculateOutOfHoursStaffDeadline(staffInput({ policy: { ...approvedPolicy, version: 'approved-v2', workingMinutes: 90 } })))
            .toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T03:30:00.000000Z', workingMinutes: 90, policyVersion: 'approved-v2' });
    });
    it('treats work periods as half-open: start is in-hours, end may begin an out-of-hours wait', () => {
        const roster = calendar([
            period('old-day', '2026-09-14T09:00:00+07:00', '2026-09-14T18:00:00+07:00'),
            ...calendar().workPeriods,
        ]);
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: roster, anchorAt: '2026-09-14T09:00:00+07:00' })))
            .toEqual({ state: 'needs_policy', reason: 'ANCHOR_IN_WORKING_HOURS' });
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: roster, anchorAt: '2026-09-14T18:00:00+07:00' })))
            .toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T04:00:00.000000Z' });
    });
    it('may finish exactly at a covered shift end; adjacent periods do not double-count', () => {
        const roster = calendar([
            period('first', '2026-09-15T09:00:00+07:00', '2026-09-15T10:00:00+07:00'),
            period('second', '2026-09-15T10:00:00+07:00', '2026-09-15T11:00:00+07:00'),
        ]);
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: { ...roster, coverage: { ...roster.coverage, endsAt: '2026-09-15T11:00:00+07:00' } } })))
            .toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T04:00:00.000000Z', usedWorkPeriodIds: ['first', 'second'] });
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: roster, anchorAt: '2026-09-15T10:00:00+07:00' })))
            .toEqual({ state: 'needs_policy', reason: 'ANCHOR_IN_WORKING_HOURS' });
    });
    it('sorts a private copy without mutating a frozen calendar or policy', () => {
        const roster = calendar(Object.freeze([...calendar().workPeriods].reverse().map(row => Object.freeze(row))));
        Object.freeze(roster.coverage); Object.freeze(roster); const before = JSON.stringify(roster);
        const input = Object.freeze(staffInput({ calendar: roster, policy: Object.freeze({ ...approvedPolicy }) }));
        expect(calculateOutOfHoursStaffDeadline(input)).toMatchObject({ state: 'ready', usedWorkPeriodIds: ['morning'] });
        expect(JSON.stringify(roster)).toBe(before);
    });
    it.each([
        [{ ownership: 'changed' }, 'OWNER_CHANGED'], [{ ownership: 'unknown' }, 'OWNER_HISTORY_UNKNOWN'],
        [{ ownership: undefined }, 'OWNER_HISTORY_UNKNOWN'], [{ policy: null }, 'OUT_OF_HOURS_RULE_UNAPPROVED'],
        [{ policy: { ...approvedPolicy, approval: 'unapproved' } }, 'OUT_OF_HOURS_RULE_UNAPPROVED'],
    ])('does not invent an unapproved fairness rule %j', (changes, reason) => {
        expect(calculateOutOfHoursStaffDeadline(staffInput(changes as Partial<OutOfHoursStaffInput>))).toEqual({ state: 'needs_policy', reason });
    });
    it.each([0, -1, 1.5, NaN, Infinity, '120', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid staff duration %j', workingMinutes => {
        expect(calculateOutOfHoursStaffDeadline(staffInput({ policy: { ...approvedPolicy, workingMinutes } as unknown as OutOfHoursStaffPolicy })))
            .toEqual({ state: 'needs_policy', reason: 'INVALID_STAFF_POLICY' });
    });
    it.each([
        [{ anchorAt: null }, 'MISSING_ANCHOR'], [{ anchorAt: '2026-09-14T21:00' }, 'INVALID_ANCHOR'],
        [{ ownerUserId: null }, 'MISSING_OWNER'], [{ ownerUserId: 'bad\u0000id' }, 'INVALID_OWNER'],
        [{ calendar: null }, 'MISSING_CALENDAR'],
    ])('returns no deadline or blame with incomplete prerequisite %j', (changes, reason) => {
        expect(calculateOutOfHoursStaffDeadline(staffInput(changes as Partial<OutOfHoursStaffInput>))).toEqual({ state: 'not_ready', reason });
    });
    it.each([
        [{ leaveAndBreaksSubtracted: false }, 'EXCLUSIONS_NOT_APPLIED'],
        [{ ownerUserId: 'different-sales-id' }, 'CALENDAR_OWNER_MISMATCH'],
        [{ coverage: { ...calendar().coverage, complete: false } }, 'INCOMPLETE_COVERAGE'],
        [{ coverage: { ...calendar().coverage, startsAt: '2026-09-15T00:00:00+07:00' } }, 'ANCHOR_OUTSIDE_COVERAGE'],
        [{ coverage: { ...calendar().coverage, endsAt: originalLead.originalLeadAt } }, 'ANCHOR_OUTSIDE_COVERAGE'],
    ])('fails closed on unusable calendar evidence %j', (changes, reason) => {
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: { ...calendar(), ...changes } as SlaWorkCalendar })))
            .toEqual({ state: 'not_ready', reason });
    });
    it.each([
        [period('a', '2026-09-15T09:00:00+07:00', '2026-09-15T11:00:00+07:00'), period('b', '2026-09-15T10:00:00+07:00', '2026-09-15T12:00:00+07:00')],
        [period('same-id', '2026-09-15T09:00:00+07:00', '2026-09-15T10:00:00+07:00'), period('same-id', '2026-09-15T11:00:00+07:00', '2026-09-15T12:00:00+07:00')],
        [period('a', '2026-09-15T09:00:00+07:00', '2026-09-15T11:00:00+07:00'), period('duplicate', '2026-09-15T09:00:00+07:00', '2026-09-15T11:00:00+07:00')],
        [period('backwards', '2026-09-15T11:00:00+07:00', '2026-09-15T09:00:00+07:00')],
        [period('zero', '2026-09-15T09:00:00+07:00', '2026-09-15T09:00:00+07:00')],
        [period('outside', '2026-09-13T09:00:00+07:00', '2026-09-13T11:00:00+07:00')],
        [period('outside', '2026-09-18T09:00:00+07:00', '2026-09-18T11:00:00+07:00')],
        [period('invalid', '2026-09-15T09:00:00', '2026-09-15T11:00:00+07:00')],
    ])('never double-counts, clips or silently repairs invalid intervals %j', (...workPeriods) => {
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: calendar(workPeriods) }))).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
    it.each([[], [period('too-short', '2026-09-15T09:00:00+07:00', '2026-09-15T10:59:59.999999+07:00')]])('does not extrapolate missing future work or round up time %j', (...workPeriods) => {
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: calendar(workPeriods) }))).toEqual({ state: 'not_ready', reason: 'INSUFFICIENT_WORKING_TIME' });
    });
    it.each([null, [], {}, { ...staffInput(), ownership: true }, { ...staffInput(), serviceDueAt: '2026-09-20T00:00:00Z' }])('rejects malformed staff input and service overrides %j', input => {
        const result = calculateOutOfHoursStaffDeadline(input as unknown as OutOfHoursStaffInput);
        expect(result.state).not.toBe('ready'); expect(result).not.toHaveProperty('staffDueAt');
        expect(result).not.toHaveProperty('serviceDueAt'); expect(result).not.toHaveProperty('score');
    });
    it.each([[], {}, { ...calendar(), coverage: null }, { ...calendar(), coverage: { ...calendar().coverage, endsAt: 'bad' } },
        { ...calendar(), workPeriods: null }, { ...calendar(), workPeriods: [null] }, { ...calendar(), score: 100 }])('does not evaluate malformed calendar %j', value => {
        expect(calculateOutOfHoursStaffDeadline(staffInput({ calendar: value as unknown as SlaWorkCalendar })))
            .toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
    it('keeps caller-approved ownership/postponement changes out of service arithmetic and has no scoring side effects', () => {
        const before = JSON.stringify(originalLead);
        const source = Object.freeze({ ...originalLead });
        const result = calculateServiceDeadline(source);
        calculateOutOfHoursStaffDeadline(staffInput({ ownership: 'unknown', calendar: null }));
        expect(calculateServiceDeadline(source)).toEqual(result); expect(JSON.stringify(source)).toBe(before);
        expect(result).not.toHaveProperty('score'); expect(result).not.toHaveProperty('completed'); expect(result).not.toHaveProperty('notifyAt');
    });
});
