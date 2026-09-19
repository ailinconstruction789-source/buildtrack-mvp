import { describe, expect, it } from 'vitest';
import { buildSlaPreview } from '../slaPreviewEngine';
import type { SlaPreviewSource, SlaPreviewSourceTask } from '../slaPreviewTypes';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function task(overrides: Partial<SlaPreviewSourceTask> = {}): SlaPreviewSourceTask {
    return { id: id(1), customerId: id(2), customerName: 'ลูกค้าทดสอบ', ownerUserId: id(3), scopeOwnerUserId: id(3), ownerName: 'Sales A',
        ownerIsActiveSales: true, lifecycleRevision: id(4), scopeClosed: false, recordOrigin: 'live',
        leadCreatedAt: '2026-09-17T03:00:00Z', obligationStartedAt: '2026-09-17T03:00:00Z', taskCreatedAt: '2026-09-17T03:00:00Z', serviceDueAt: '2026-09-18T03:00:00Z',
        initialContactHours: 24, creationProven: true, ownerHistoryUnchanged: true, lifecycleReviewPending: false,
        hasContactEvidence: false, hasCustomerPostponement: false, hasExceptions: false,
        calendar: { id: id(5), version: id(6), ownerUserId: id(3),
            coverage: { startsAt: '2026-09-17T00:00:00Z', endsAt: '2026-09-21T00:00:00Z', complete: true },
            periods: [17, 18, 19].map(day => ({ id: id(day), salesUserId: id(3), type: 'work', startsAt: `2026-09-${day}T02:00:00Z`, endsAt: `2026-09-${day}T11:00:00Z` })) },
        ...overrides };
}
function source(tasks: readonly SlaPreviewSourceTask[] = [task()], asOf = '2026-09-18T02:30:00Z'): SlaPreviewSource {
    return { actor: { userId: id(9), role: 'admin' }, asOf, page: 0, pageSize: 20, hasMore: false,
        settings: { version: 1, initialContactHours: 24, nextShiftResponseMinutes: 120 }, tasks };
}
function outOfHours() { return task({ leadCreatedAt: '2026-09-17T14:00:00Z', obligationStartedAt: '2026-09-17T14:00:00Z',
    taskCreatedAt: '2026-09-17T14:00:00Z', serviceDueAt: '2026-09-18T14:00:00Z' }); }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
describe('trusted source to read-only initial-contact preview', () => {
    it('composes in-hours service deadline, current calendar, and the confirmed30-minute reminder', () => {
        const input = freeze(source()); const before = JSON.stringify(input);
        const result = buildSlaPreview(input);
        expect(result).toMatchObject({ mode: 'dry_run', dueSoonMinutes: 30, policyVersion: 'first_contact_preview_2026_09_17',
            rows: [{ state: 'would_notify', reason: 'DUE_SOON', rule: 'service_deadline', notificationType: 'due_soon',
                staffDueAt: '2026-09-18T03:00:00Z', serviceDueAt: '2026-09-18T03:00:00Z', calendarVersion: id(6) }] });
        expect(JSON.stringify(input)).toBe(before);
        const publicResult = JSON.stringify(result);
        for (const forbidden of ['periods', 'settings', 'creationProven', 'notificationBinding', 'dedupeKey', 'usedWorkPeriodIds', 'evaluation_snapshot']) expect(publicResult).not.toContain(forbidden);
    });
    it('uses the out-of-hours two working-hour rule without changing the customer deadline', () => {
        const result = buildSlaPreview(source([outOfHours()], '2026-09-18T03:30:00Z')).rows[0];
        expect(result).toMatchObject({ state: 'would_notify', rule: 'out_of_hours', staffDueAt: '2026-09-18T04:00:00.000000Z',
            notifyAt: '2026-09-18T02:00:00.000000Z', serviceDueAt: '2026-09-18T14:00:00Z' });
    });
    it('moves only staff deadline after an in-hours lead whose service deadline is outside the next work day', () => {
        const row = task({ leadCreatedAt: '2026-09-17T10:00:00Z', obligationStartedAt: '2026-09-17T10:00:00Z',
            taskCreatedAt: '2026-09-17T10:00:00Z', serviceDueAt: '2026-09-18T10:00:00Z' });
        const calendar = row.calendar!;
        const changed = { ...row, calendar: { ...calendar, periods: calendar.periods.map(period => period.id === id(18) ? { ...period, endsAt: '2026-09-18T06:00:00Z' } : period) } };
        expect(buildSlaPreview(source([changed], '2026-09-19T03:30:00Z')).rows[0]).toMatchObject({ state: 'would_notify',
            rule: 'off_shift_service_deadline', staffDueAt: '2026-09-19T04:00:00.000000Z', serviceDueAt: row.serviceDueAt });
    });
    it('subtracts approved break/leave before composing clocks, not after setting a deadline', () => {
        const row = outOfHours();
        const changed = { ...row, calendar: { ...row.calendar!, periods: [...row.calendar!.periods,
            { id: id(25), salesUserId: id(3), type: 'break' as const, startsAt: '2026-09-18T02:45:00Z', endsAt: '2026-09-18T03:15:00Z' }] } };
        expect(buildSlaPreview(source([changed], '2026-09-18T04:00:00Z')).rows[0]).toMatchObject({ state: 'would_notify', staffDueAt: '2026-09-18T04:30:00.000000Z' });
    });
    it.each([
        ['2026-09-18T02:29:59.999999Z', 'scheduled', 'NOT_DUE_YET'],
        ['2026-09-18T02:30:00.000000Z', 'would_notify', 'DUE_SOON'],
        ['2026-09-18T03:00:00.000000Z', 'would_notify', 'DUE_SOON'],
        ['2026-09-18T03:00:00.000001Z', 'would_notify', 'OVERDUE'],
        ['2026-09-18T11:00:00Z', 'scheduled', 'OUTSIDE_WORKING_HOURS'],
    ])('classifies exact asOf %s as %s/%s', (asOf, state, reason) => {
        expect(buildSlaPreview(source([task()], asOf)).rows[0]).toMatchObject({ state, reason });
    });
    it.each([
        [{ scopeClosed: true }, 'SCOPE_CLOSED'], [{ recordOrigin: 'legacy_import' }, 'LEGACY_REVIEW'],
        [{ ownerUserId: null }, 'OWNER_NOT_READY'], [{ ownerIsActiveSales: false }, 'OWNER_NOT_READY'],
        [{ scopeOwnerUserId: id(8) }, 'OWNER_NOT_READY'], [{ creationProven: false }, 'MISSING_CREATION_EVIDENCE'],
        [{ ownerHistoryUnchanged: false }, 'OWNER_REVIEW'], [{ lifecycleReviewPending: true }, 'OWNER_REVIEW'],
        [{ hasContactEvidence: true }, 'CONTACT_REVIEW'], [{ hasCustomerPostponement: true }, 'CUSTOMER_POSTPONEMENT'],
        [{ hasExceptions: true }, 'EXCEPTION_REVIEW'], [{ initialContactHours: null }, 'POLICY_REVIEW'],
        [{ initialContactHours: 48 }, 'POLICY_REVIEW'], [{ calendar: null }, 'MISSING_CALENDAR'],
        [{ leadCreatedAt: null }, 'SOURCE_TIME_REVIEW'], [{ obligationStartedAt: '2026-09-17T03:00:00.000001Z' }, 'SOURCE_TIME_REVIEW'],
        [{ serviceDueAt: '2026-09-18T03:00:00.000001Z' }, 'SOURCE_TIME_REVIEW'],
        [{ taskCreatedAt: '2026-09-19T03:00:00Z' }, 'SOURCE_TIME_REVIEW'],
        [{ taskCreatedAt: '2026-09-17T02:59:59.999999Z' }, 'SOURCE_TIME_REVIEW'],
    ] as const)('holds source issues %j without publishing computed deadlines', (patch, reason) => {
        expect(buildSlaPreview(source([task(patch)])).rows[0]).toMatchObject({ state: 'held', reason, staffDueAt: null, notifyAt: null,
            rule: null, calendarVersion: null, notificationType: null });
    });
    it.each([{ initialContactHours: 25 }, { nextShiftResponseMinutes: 121 }])('holds unsupported current settings %j, never rewrites original service time', patch => {
        const input = source();
        const result = buildSlaPreview({ ...input, settings: { ...input.settings, ...patch } }).rows[0];
        expect(result.reason).toBe('POLICY_REVIEW'); expect(result.serviceDueAt).toBe(input.tasks[0].serviceDueAt);
    });
    it.each(['incomplete', 'wrong_owner', 'overlap', 'too_short'] as const)('holds unusable %s calendar instead of guessing shifts', mode => {
        const row = task(), calendar = row.calendar!;
        const changed = { ...row, calendar: { ...calendar,
            ownerUserId: mode === 'wrong_owner' ? id(8) : calendar.ownerUserId,
            coverage: { ...calendar.coverage, complete: mode !== 'incomplete', endsAt: mode === 'too_short' ? '2026-09-18T02:59:59Z' : calendar.coverage.endsAt },
            periods: mode === 'overlap' ? [...calendar.periods, { ...calendar.periods[0], id: id(66) }]
                : mode === 'too_short' ? [calendar.periods[0]] : calendar.periods } };
        expect(buildSlaPreview(source([changed])).rows[0]).toMatchObject({ state: 'held', staffDueAt: null });
    });
    it('holds a current evaluation outside the complete roster coverage', () => {
        expect(buildSlaPreview(source([task()], '2026-09-22T00:00:00Z')).rows[0]).toMatchObject({ state: 'held', reason: 'INSUFFICIENT_COVERAGE' });
    });
    it('retains all rows including held ones, scope metadata and page flags without mutating original tasks', () => {
        const input = { ...source([task(), task({ id: id(7), hasExceptions: true })]), page: 3, hasMore: true };
        const result = buildSlaPreview(input);
        expect(result).toMatchObject({ actor: input.actor, asOf: input.asOf, page: 3, pageSize: 20, hasMore: true });
        expect(result.rows.map(row => row.state)).toEqual(['would_notify', 'held']); expect(input.tasks[1].hasExceptions).toBe(true);
    });
});
