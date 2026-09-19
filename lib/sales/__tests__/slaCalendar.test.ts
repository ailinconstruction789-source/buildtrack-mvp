import { describe, expect, it } from 'vitest';
import { parseEvidenceTimestamp } from '../leadEvidence';
import { prepareSlaWorkCalendar, type RawSlaWorkCalendar, type RawSlaWorkPeriod } from '../slaCalendar';
import { calculateOutOfHoursStaffDeadline, calculateServiceDeadline, type SlaWorkCalendar } from '../slaClock';

const ownerUserId = 'sales-roster-owner';
const row = (id: string, type: RawSlaWorkPeriod['type'], startsAt: string, endsAt: string): RawSlaWorkPeriod => ({ id, type, salesUserId: ownerUserId, startsAt, endsAt });
const morning = row('work-source-1', 'work', '2026-09-15T09:00:00+07:00', '2026-09-15T12:00:00+07:00');
const afternoon = row('work-source-2', 'work', '2026-09-15T13:00:00+07:00', '2026-09-15T18:00:00+07:00');
function raw(periods: readonly RawSlaWorkPeriod[] = [morning, afternoon]): RawSlaWorkCalendar {
    return { id: 'trusted-roster-snapshot', version: 'roster-v4', ownerUserId,
        coverage: { startsAt: '2026-09-14T00:00:00+07:00', endsAt: '2026-09-21T00:00:00+07:00', complete: true }, periods };
}
function ready(input = raw()) {
    const result = prepareSlaWorkCalendar(input);
    if (result.state !== 'ready') throw new Error(`Expected prepared calendar, received ${result.reason}`);
    return result;
}
function due(calendar: SlaWorkCalendar, anchorAt = '2026-09-14T21:00:00+07:00') {
    return calculateOutOfHoursStaffDeadline({ anchorAt, ownerUserId, ownership: 'unchanged', calendar,
        policy: { rule: 'next_actual_work_period', approval: 'approved', version: 'test-approved-policy', workingMinutes: 120 } });
}
const ranges = (calendar: SlaWorkCalendar) => calendar.workPeriods.map(period => [period.startsAt, period.endsAt]);
const unsafe = (value: unknown) => value as RawSlaWorkCalendar;

describe('trusted raw roster preparation', () => {
    it('produces only the explicit clock contract and minimal work-source lineage', () => {
        const result = ready();
        expect(result.calendar).toEqual({ id: 'trusted-roster-snapshot', version: 'roster-v4', ownerUserId,
            coverage: { startsAt: '2026-09-13T17:00:00.000000Z', endsAt: '2026-09-20T17:00:00.000000Z', complete: true },
            leaveAndBreaksSubtracted: true,
            workPeriods: [
                { id: `sla:${parseEvidenceTimestamp(morning.startsAt)}:${parseEvidenceTimestamp(morning.endsAt)}`, startsAt: '2026-09-15T02:00:00.000000Z', endsAt: '2026-09-15T05:00:00.000000Z' },
                { id: `sla:${parseEvidenceTimestamp(afternoon.startsAt)}:${parseEvidenceTimestamp(afternoon.endsAt)}`, startsAt: '2026-09-15T06:00:00.000000Z', endsAt: '2026-09-15T11:00:00.000000Z' },
            ] });
        expect(result.lineage).toEqual(result.calendar.workPeriods.map((period, index) => ({ workPeriodId: period.id, sourcePeriodId: [morning.id, afternoon.id][index] })));
        expect(due(result.calendar)).toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T04:00:00.000000Z', calendarVersion: 'roster-v4' });
    });

    it('subtracts the UNION of overlapping, nested, duplicate-range and adjacent exclusions exactly once', () => {
        const result = ready(raw([
            row('full', 'work', '2026-09-15T09:00:00+07:00', '2026-09-15T18:00:00+07:00'),
            row('break-1', 'break', '2026-09-15T10:00:00+07:00', '2026-09-15T11:00:00+07:00'),
            row('leave-1', 'leave', '2026-09-15T10:30:00+07:00', '2026-09-15T12:00:00+07:00'),
            row('break-2', 'break', '2026-09-15T12:00:00+07:00', '2026-09-15T13:00:00+07:00'),
            row('leave-2', 'leave', '2026-09-15T10:40:00+07:00', '2026-09-15T10:50:00+07:00'),
            row('break-3', 'break', '2026-09-15T12:00:00+07:00', '2026-09-15T13:00:00+07:00'),
        ]));
        expect(ranges(result.calendar)).toEqual([
            ['2026-09-15T02:00:00.000000Z', '2026-09-15T03:00:00.000000Z'],
            ['2026-09-15T06:00:00.000000Z', '2026-09-15T11:00:00.000000Z'],
        ]);
        expect(due(result.calendar)).toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T07:00:00.000000Z' });
        expect(result.lineage.map(item => item.sourcePeriodId)).toEqual(['full', 'full']);
        expect(JSON.stringify(result)).not.toMatch(/leave-1|leave-2|break-1|break-2|break-3/);
    });

    it('counts two actual working hours across a break, another day and approved whole-day leave', () => {
        const result = ready(raw([
            row('short-shift', 'work', '2026-09-15T09:00:00+07:00', '2026-09-15T11:30:00+07:00'),
            row('break', 'break', '2026-09-15T09:30:00+07:00', '2026-09-15T10:30:00+07:00'),
            row('leave-day-shift', 'work', '2026-09-16T09:00:00+07:00', '2026-09-16T18:00:00+07:00'),
            row('leave', 'leave', '2026-09-16T00:00:00+07:00', '2026-09-17T00:00:00+07:00'),
            row('next-shift', 'work', '2026-09-17T08:00:00+07:00', '2026-09-17T10:00:00+07:00'),
        ]));
        expect(due(result.calendar)).toMatchObject({ state: 'ready', workStartsAt: '2026-09-15T02:00:00.000000Z', staffDueAt: '2026-09-17T01:30:00.000000Z',
            usedWorkPeriodIds: result.calendar.workPeriods.map(period => period.id) });
        expect(result.lineage.map(item => item.sourcePeriodId)).toEqual(['short-shift', 'short-shift', 'next-shift']);
        expect(calculateServiceDeadline({ kind: 'first_contact', leadId: 'original-lead', originalLeadAt: '2026-09-14T21:00:00+07:00' }))
            .toMatchObject({ state: 'ready', serviceDueAt: '2026-09-15T14:00:00.000000Z' });
    });

    it('keeps half-open endpoints and microseconds exact through the downstream clock', () => {
        const result = ready(raw([
            row('work', 'work', '2026-09-15T09:00:00.000001+07:00', '2026-09-15T13:00:00+07:00'),
            row('break', 'break', '2026-09-15T10:00:00+07:00', '2026-09-15T11:00:00.000001+07:00'),
            row('before', 'leave', '2026-09-15T08:00:00+07:00', '2026-09-15T09:00:00.000001+07:00'),
            row('after', 'leave', '2026-09-15T13:00:00+07:00', '2026-09-15T14:00:00+07:00'),
        ]));
        expect(ranges(result.calendar)).toEqual([
            ['2026-09-15T02:00:00.000001Z', '2026-09-15T03:00:00.000000Z'],
            ['2026-09-15T04:00:00.000001Z', '2026-09-15T06:00:00.000000Z'],
        ]);
        expect(due(result.calendar)).toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T05:00:00.000002Z' });
        expect(due(result.calendar, '2026-09-15T09:00:00.000001+07:00')).toEqual({ state: 'needs_policy', reason: 'ANCHOR_IN_WORKING_HOURS' });
        expect(due(result.calendar, '2026-09-15T10:00:00+07:00')).toEqual({ state: 'not_ready', reason: 'INSUFFICIENT_WORKING_TIME' });
    });

    it('retains separate adjacent work-source records without gaps or double counting', () => {
        const result = ready(raw([
            row('one', 'work', '2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z'),
            row('two', 'work', '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z'),
        ]));
        expect(result.calendar.workPeriods).toHaveLength(2);
        expect(result.lineage.map(item => item.sourcePeriodId)).toEqual(['one', 'two']);
        expect(due(result.calendar)).toMatchObject({ state: 'ready', staffDueAt: '2026-09-15T11:00:00.000000Z' });
    });

    it('applies a single exclusion spanning multiple work intervals and their gaps', () => {
        const result = ready(raw([morning, afternoon,
            row('wide', 'leave', '2026-09-15T11:00:00+07:00', '2026-09-15T14:00:00+07:00'),
        ]));
        expect(ranges(result.calendar)).toEqual([
            ['2026-09-15T02:00:00.000000Z', '2026-09-15T04:00:00.000000Z'],
            ['2026-09-15T07:00:00.000000Z', '2026-09-15T11:00:00.000000Z'],
        ]);
    });

    it('clips approved exclusions to covered work, accepting exclusions outside coverage without creating work', () => {
        const input = raw([morning,
            row('early', 'leave', '2026-09-01T00:00:00Z', '2026-09-15T10:00:00+07:00'),
            row('late', 'break', '2026-09-15T11:00:00+07:00', '2026-09-30T00:00:00Z'),
            row('irrelevant-before', 'break', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z'),
            row('irrelevant-after', 'leave', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
        ]);
        expect(ranges(ready(input).calendar)).toEqual([['2026-09-15T03:00:00.000000Z', '2026-09-15T04:00:00.000000Z']]);
    });

    it.each([[], [row('leave-only', 'leave', '2026-09-15T09:00:00+07:00', '2026-09-15T18:00:00+07:00')],
        [morning, afternoon, row('all-leave', 'leave', '2026-09-13T00:00:00+07:00', '2026-09-22T00:00:00+07:00')],
    ].map(periods => ({ periods })))('allows proven zero work without inventing shifts or a staff deadline: %j', ({ periods }) => {
        const result = ready(raw(periods));
        expect(result.calendar.workPeriods).toEqual([]);
        expect(result.lineage).toEqual([]);
        expect(due(result.calendar)).toEqual({ state: 'not_ready', reason: 'INSUFFICIENT_WORKING_TIME' });
    });

    it('uses explicitly supplied weekend/night work without inventing a weekday filter or 09:00 start', () => {
        const result = ready(raw([row('saturday-night', 'work', '2026-09-19T22:15:00+07:00', '2026-09-20T04:00:00+07:00')]));
        expect(due(result.calendar)).toMatchObject({ state: 'ready', workStartsAt: '2026-09-19T15:15:00.000000Z', staffDueAt: '2026-09-19T17:15:00.000000Z' });
    });

    it('sorts private copies of frozen input and produces stable IDs independent of input order or offsets', () => {
        const leave = row('break', 'break', '2026-09-15T10:00:00+07:00', '2026-09-15T11:00:00+07:00');
        const input = raw(Object.freeze([afternoon, leave, morning].map(period => Object.freeze({ ...period }))));
        Object.freeze(input.coverage); Object.freeze(input);
        const before = JSON.stringify(input);
        const result = ready(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(result).toEqual(ready(raw([morning, leave, afternoon])));
        expect(result).toEqual(ready(raw([
            { ...morning, startsAt: '2026-09-15T02:00:00Z', endsAt: '2026-09-15T05:00:00Z' },
            { ...leave, startsAt: '2026-09-15T03:00:00Z', endsAt: '2026-09-15T04:00:00Z' }, afternoon,
        ])));
        expect(result.calendar.coverage).not.toBe(input.coverage);
        expect(result.calendar.workPeriods.every(period => !input.periods.includes(period as RawSlaWorkPeriod))).toBe(true);
        const ids = result.calendar.workPeriods.map(period => period.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every(id => id.length <= 200)).toBe(true);
    });

    it('keeps source IDs at their maximum length without overflowing generated segment IDs', () => {
        const source = { ...morning, id: 'ก'.repeat(200) };
        const result = ready(raw([source]));
        expect(result.lineage[0].sourcePeriodId).toBe(source.id);
        expect(result.calendar.workPeriods[0].id.length).toBeLessThanOrEqual(200);
        expect(due(result.calendar)).toMatchObject({ state: 'ready' });
    });

    it.each([
        ['0001-01-01T00:00:00.000001Z', '0001-01-01T02:00:00.000001Z', '0001-01-01T00:00:00Z', '0001-01-02T00:00:00Z'],
        ['1969-12-30T23:59:59.999999Z', '1969-12-31T01:59:59.999999Z', '1969-12-30T00:00:00Z', '1970-01-01T00:00:00Z'],
        ['9999-12-31T21:59:59.999999Z', '9999-12-31T23:59:59.999999Z', '9999-12-31T00:00:00Z', '9999-12-31T23:59:59.999999Z'],
    ])('normalizes the full four-digit Gregorian range without microsecond loss %s', (startsAt, endsAt, coverageStart, coverageEnd) => {
        const result = ready({ ...raw([row('work', 'work', startsAt, endsAt)]), coverage: { startsAt: coverageStart, endsAt: coverageEnd, complete: true } });
        expect(ranges(result.calendar)).toEqual([[startsAt, endsAt]]);
        expect(due(result.calendar, coverageStart)).toMatchObject({ state: 'ready', staffDueAt: endsAt });
    });
});

describe('fail-closed raw roster evidence', () => {
    it.each([null, undefined])('keeps missing calendar unknown %j', value => {
        expect(prepareSlaWorkCalendar(value)).toEqual({ state: 'not_ready', reason: 'MISSING_CALENDAR' });
    });
    it.each([false, 0, '', [], {}, { ...raw(), id: '' }, { ...raw(), version: null },
        { ...raw(), periods: null }, { ...raw(), periods: {} },
    ])('rejects malformed calendar %j', value => {
        expect(prepareSlaWorkCalendar(unsafe(value))).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
    });
    it.each([null, undefined, ''])('requires a known owner %j', owner => {
        expect(prepareSlaWorkCalendar(unsafe({ ...raw(), ownerUserId: owner }))).toEqual({ state: 'not_ready', reason: 'MISSING_OWNER' });
    });
    it.each([0, false, ' owner ', 'bad\u0000id', 'bad\u2028id', '\ud800', 'x'.repeat(201)])('rejects malformed identity %j', value => {
        expect(prepareSlaWorkCalendar(unsafe({ ...raw(), ownerUserId: value }))).toEqual({ state: 'not_ready', reason: 'INVALID_OWNER' });
        expect(prepareSlaWorkCalendar(unsafe({ ...raw(), id: value }))).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
        expect(prepareSlaWorkCalendar(unsafe({ ...raw(), version: value }))).toEqual({ state: 'not_ready', reason: 'INVALID_CALENDAR' });
        expect(prepareSlaWorkCalendar(unsafe(raw([{ ...morning, id: value } as RawSlaWorkPeriod])))).toEqual({ state: 'not_ready', reason: 'INVALID_PERIOD' });
    });
    it('requires positive complete coverage, never infers completeness from a supplied shift', () => {
        expect(prepareSlaWorkCalendar({ ...raw(), coverage: { ...raw().coverage, complete: false } })).toEqual({ state: 'not_ready', reason: 'INCOMPLETE_COVERAGE' });
    });
    it.each([null, [], {}, { ...raw().coverage, complete: 'true' }, { ...raw().coverage, complete: 1 }, { ...raw().coverage, complete: undefined },
        { ...raw().coverage, endsAt: raw().coverage.startsAt }, { ...raw().coverage, startsAt: raw().coverage.endsAt },
    ])('rejects malformed/ambiguous coverage %j', coverage => {
        expect(prepareSlaWorkCalendar(unsafe({ ...raw(), coverage }))).toEqual({ state: 'not_ready', reason: 'INVALID_COVERAGE' });
    });
    it.each(['work', 'leave', 'break'] as const)('rejects another owner even for irrelevant %s rows outside coverage', type => {
        const outside = row('foreign-row', type, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');
        expect(prepareSlaWorkCalendar(raw([{ ...outside, salesUserId: 'someone-else' }]))).toEqual({ state: 'not_ready', reason: 'CALENDAR_OWNER_MISMATCH' });
    });
    it.each(['work', 'leave', 'break'] as const)('requires unique IDs across all kinds including %s', type => {
        expect(prepareSlaWorkCalendar(raw([morning, { ...afternoon, id: morning.id, type }]))).toEqual({ state: 'not_ready', reason: 'DUPLICATE_PERIOD_ID' });
    });
    it.each([null, [], {}, { ...morning, id: null }, { ...morning, salesUserId: null }, { ...morning, type: undefined },
        { ...morning, type: 'holiday' }, { ...morning, type: ['work'] }, { ...morning, endsAt: morning.startsAt },
        { ...morning, startsAt: morning.endsAt },
    ])('rejects malformed source periods %j', period => {
        expect(prepareSlaWorkCalendar(unsafe({ ...raw(), periods: [period] }))).toEqual({ state: 'not_ready', reason: 'INVALID_PERIOD' });
    });
    it.each(['2026-02-29T09:00:00Z', '2026-04-31T09:00:00Z', '2026-09-15', '2026-09-15T09:00:00',
        '2026-09-15T24:00:00Z', '2026-09-15T09:00:60Z', '2026-09-15T09:00:00-00:00', '2026-09-15T09:00:00.1234567Z',
        '2026-09-15T09:00:00Z\n', '2026-09-15T09:00:00Z\u2028', '0001-01-01T00:00:00+01:00', '9999-12-31T23:59:59-01:00', 'infinity', 0,
    ])('rejects invalid or out-of-range timestamps without rounding %j', time => {
        for (const field of ['startsAt', 'endsAt']) {
            expect(prepareSlaWorkCalendar(unsafe({ ...raw(), coverage: { ...raw().coverage, [field]: time } }))).toEqual({ state: 'not_ready', reason: 'INVALID_COVERAGE' });
            expect(prepareSlaWorkCalendar(unsafe({ ...raw(), periods: [{ ...morning, [field]: time }] }))).toEqual({ state: 'not_ready', reason: 'INVALID_PERIOD' });
        }
    });
    it.each([
        row('early', 'work', '2026-09-13T00:00:00+07:00', '2026-09-15T12:00:00+07:00'),
        row('late', 'work', '2026-09-15T09:00:00+07:00', '2026-09-22T00:00:00+07:00'),
        row('outside', 'work', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z'),
    ])('does not silently clip work to hide incomplete evidence %j', period => {
        expect(prepareSlaWorkCalendar(raw([period]))).toEqual({ state: 'not_ready', reason: 'WORK_OUTSIDE_COVERAGE' });
    });
    it.each([
        row('duplicate-range', 'work', morning.startsAt, morning.endsAt),
        row('nested', 'work', '2026-09-15T10:00:00+07:00', '2026-09-15T11:00:00+07:00'),
        row('overlap', 'work', '2026-09-15T11:00:00+07:00', '2026-09-15T14:00:00+07:00'),
        row('microsecond-overlap', 'work', '2026-09-15T11:59:59.999999+07:00', '2026-09-15T14:00:00+07:00'),
    ])('rejects ambiguous overlapping work even if all work would be excluded %j', period => {
        expect(prepareSlaWorkCalendar(raw([period, morning, row('leave', 'leave', raw().coverage.startsAt, raw().coverage.endsAt)])))
            .toEqual({ state: 'not_ready', reason: 'OVERLAPPING_WORK' });
    });
    it.each([
        { ...raw(), leaveAndBreaksSubtracted: true }, { ...raw(), customerName: 'private customer' }, { ...raw(), score: 100 },
        { ...raw(), coverage: { ...raw().coverage, hrApprovedBy: 'private staff record' } },
        { ...raw(), periods: [{ ...morning, reason: 'private medical reason' }] },
        { ...raw(), periods: [{ ...morning, approval: 'unapproved' }] },
    ])('does not forward private/extraneous data or interpret source approval fields %j', value => {
        const result = prepareSlaWorkCalendar(unsafe(value));
        expect(result.state).toBe('not_ready');
        expect(Object.keys(result).sort()).toEqual(['reason', 'state']);
        expect(JSON.stringify(result)).not.toMatch(/private|medical|customer|approved|score|staff record/);
    });
    it('limits input size before processing any source rows', () => {
        expect(prepareSlaWorkCalendar(raw(Array.from({ length: 10_001 }, () => morning)))).toEqual({ state: 'not_ready', reason: 'TOO_MANY_PERIODS' });
    });
    it('accepts the clock maximum of 10,000 adjacent work rows with unique bounded IDs', () => {
        const base = Date.parse('2026-09-15T02:00:00Z');
        const periods = Array.from({ length: 10_000 }, (_, index) => row(`source-${index}`, 'work',
            new Date(base + index).toISOString(), new Date(base + index + 1).toISOString()));
        const result = ready(raw(periods));
        expect(result.calendar.workPeriods).toHaveLength(10_000);
        expect(new Set(result.calendar.workPeriods.map(period => period.id)).size).toBe(10_000);
        expect(due(result.calendar)).toEqual({ state: 'not_ready', reason: 'INSUFFICIENT_WORKING_TIME' });
    });
});

describe('exact subtraction against a finite microsecond-set oracle', () => {
    it('matches work minus exclusions across unsorted, overlapping and spanning ranges', () => {
        const stamp = (micro: number) => `2026-09-15T09:00:00.${micro.toString().padStart(6, '0')}Z`;
        const base = parseEvidenceTimestamp(stamp(0))!;
        const workRanges = [[0, 20], [30, 50], [60, 100]];
        for (let seed = 0; seed < 64; seed++) {
            let state = seed + 1;
            const next = () => { state = (state * 1664525 + 1013904223) >>> 0; return state % 101; };
            const exclusions = Array.from({ length: 12 }, () => {
                const a = next(), b = next();
                return [Math.min(a, b), Math.max(a, b)] as const;
            }).filter(([start, end]) => start < end);
            const periods = [
                ...workRanges.map(([start, end], index) => row(`work-${index}`, 'work', stamp(start), stamp(end))),
                ...exclusions.map(([start, end], index) => row(`exclude-${index}`, index % 2 ? 'leave' : 'break', stamp(start), stamp(end))),
            ].reverse();
            const result = ready({ ...raw(periods), coverage: { startsAt: stamp(0), endsAt: stamp(100), complete: true } });
            const actual = new Set<number>();
            for (const period of result.calendar.workPeriods) {
                const start = Number(parseEvidenceTimestamp(period.startsAt)! - base);
                const end = Number(parseEvidenceTimestamp(period.endsAt)! - base);
                expect(start).toBeLessThan(end);
                for (let point = start; point < end; point++) {
                    expect(actual.has(point)).toBe(false);
                    actual.add(point);
                }
            }
            const expected = new Set(Array.from({ length: 100 }, (_, point) => point).filter(point =>
                workRanges.some(([start, end]) => start <= point && point < end)
                && !exclusions.some(([start, end]) => start <= point && point < end)));
            expect(actual).toEqual(expected);
            expect(result.lineage).toHaveLength(result.calendar.workPeriods.length);
        }
    });
});
