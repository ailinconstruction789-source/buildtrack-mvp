import { describe, expect, it } from 'vitest';
import { SLA_PREVIEW_CONTRACT_VERSION, SlaPreviewInputError, SlaPreviewProjectionError,
    parseSlaPreviewPage, parseSlaPreviewQuery, parseSlaPreviewSnapshot, parseSlaPreviewSource } from '../slaPreviewContracts';
import { SLA_PREVIEW_REASONS } from '../slaPreviewTypes';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OWNER = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002', CUSTOMER = '00000000-0000-4000-8000-000000000003';
const REVISION = '00000000-0000-4000-8000-000000000004', CALENDAR = '00000000-0000-4000-8000-000000000005';
const VERSION = '00000000-0000-4000-8000-000000000006', PERIOD = '00000000-0000-4000-8000-000000000007';
const AT = '2026-09-17T02:45:00.123456Z', DUE = '2026-09-17T03:00:00.123456Z', LEAD = '2026-09-16T03:00:00.123456Z';
function calendar() { return { id: CALENDAR, version: VERSION, ownerUserId: OWNER,
    coverage: { startsAt: '2026-09-16T00:00:00Z', endsAt: '2026-09-18T00:00:00Z', complete: true },
    periods: [{ id: PERIOD, salesUserId: OWNER, type: 'work', startsAt: '2026-09-16T02:00:00Z', endsAt: '2026-09-16T10:00:00Z' }] }; }
function task() { return { id: TASK, customerId: CUSTOMER, customerName: 'ลูกค้า', ownerUserId: OWNER, ownerName: 'Sales', scopeOwnerUserId: OWNER,
    ownerIsActiveSales: true, lifecycleRevision: REVISION, scopeClosed: false, recordOrigin: 'live', leadCreatedAt: LEAD,
    obligationStartedAt: LEAD, serviceDueAt: DUE, taskCreatedAt: LEAD, initialContactHours: 24, creationProven: true,
    ownerHistoryUnchanged: true, lifecycleReviewPending: false, hasContactEvidence: false, hasCustomerPostponement: false,
    hasExceptions: false, calendar: calendar() }; }
function source() { return { actor: { userId: ADMIN, role: 'admin' }, asOf: AT, page: 0, pageSize: 20, hasMore: false,
    settings: { version: 1, initialContactHours: 24, nextShiftResponseMinutes: 120 }, tasks: [task()] }; }
function row() { return { taskId: TASK, customerId: CUSTOMER, customerName: 'ลูกค้า', ownerUserId: OWNER, ownerName: 'Sales', serviceDueAt: DUE,
    state: 'would_notify', reason: 'DUE_SOON', staffDueAt: DUE, notifyAt: LEAD, rule: 'service_deadline', calendarVersion: VERSION, notificationType: 'due_soon' }; }
function snapshot() { return { actor: { userId: ADMIN, role: 'admin' }, asOf: AT, page: 0, pageSize: 20, hasMore: false,
    mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17', dueSoonMinutes: 30, rows: [row()] }; }

describe('canonical read-only preview query', () => {
    it('pins contract version', () => expect(SLA_PREVIEW_CONTRACT_VERSION).toBe('first_contact_preview_v1'));
    it.each([0, 1, 1000])('accepts page %s', page => {
        expect(parseSlaPreviewPage(page)).toBe(page); expect(parseSlaPreviewQuery(`https://app.test/?page=${page}`)).toBe(page);
    });
    it('defaults only an omitted page', () => expect(parseSlaPreviewQuery('https://app.test/')).toBe(0));
    it.each([-0, -1, 1001, NaN, Infinity, null, '1', true, 1.1])('rejects page %j', value => expect(() => parseSlaPreviewPage(value)).toThrow(SlaPreviewInputError));
    it.each(['page=', 'page=01', 'page=-0', 'page=1.0', 'page=1001', 'page=0%0A', 'page=1&page=1', 'ownerId=x', 'page=0&commit=true'])('rejects query %s', query => {
        expect(() => parseSlaPreviewQuery(`https://app.test/?${query}`)).toThrow(SlaPreviewInputError);
    });
});
describe('bounded trusted preview source syntax', () => {
    it('validates source and strips extra policy/PII/evidence fields throughout', () => {
        const value = source(); const original = structuredClone(value);
        Object.assign(value, { phone: 'private' }); Object.assign(value.settings, { serviceRole: 'private' });
        Object.assign(value.tasks[0], { income: 123, rawEvaluation: {} }); Object.assign(value.tasks[0].calendar.periods[0], { reason: 'private medical reason' });
        expect(parseSlaPreviewSource(value, 0, ADMIN)).toEqual(original);
    });
    it.each(['role', 'actor', 'page'])('rejects wrong bound %s', field => {
        const value = source(); if (field === 'role') value.actor.role = 'owner'; if (field === 'actor') value.actor.userId = OWNER; if (field === 'page') value.page = 1;
        expect(() => parseSlaPreviewSource(value, 0, ADMIN)).toThrow(SlaPreviewProjectionError);
    });
    it.each([0, -1, 1.1, '24', null, 2147483648])('rejects malformed settings integer %j', value => {
        for (const key of ['version', 'initialContactHours', 'nextShiftResponseMinutes']) {
            expect(() => parseSlaPreviewSource({ ...source(), settings: { ...source().settings, [key]: value } })).toThrow(SlaPreviewProjectionError);
        }
    });
    it('preserves unknown original policy and nullable legacy evidence without defaulting', () => {
        const input = { ...task(), recordOrigin: 'legacy_import', initialContactHours: null, leadCreatedAt: null, ownerUserId: null, ownerName: null, ownerIsActiveSales: false, calendar: null };
        expect(parseSlaPreviewSource({ ...source(), tasks: [input] }).tasks[0]).toEqual(input);
    });
    it.each(['leadCreatedAt', 'obligationStartedAt', 'taskCreatedAt'])('passes syntactically valid future %s to engine review', field => {
        expect(parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), [field]: '2026-09-18T00:00:00Z' }] }).tasks).toHaveLength(1);
    });
    it('passes incomplete coverage, overlapping work, differing owners and duplicate period IDs to held engine evaluation', () => {
        const raw = calendar(); raw.coverage.complete = false; raw.ownerUserId = ADMIN; raw.periods.push({ ...raw.periods[0] });
        expect(parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), calendar: raw }] }).tasks[0].calendar).toEqual(raw);
    });
    it.each(['id', 'customerId', 'scopeOwnerUserId', 'lifecycleRevision'])('rejects malformed task UUID %s', field => {
        expect(() => parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), [field]: `${OWNER}\n` }] })).toThrow(SlaPreviewProjectionError);
    });
    it.each(['infinity', '2026-09-17', '2026-02-30T00:00:00Z', '2026-09-17T00:00:00-00:00', '2026-09-17T00:00:00.1234567Z', `${AT}\n`])('rejects timestamp %s', value => {
        expect(() => parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), taskCreatedAt: value }] })).toThrow(SlaPreviewProjectionError);
    });
    it('requires every boolean/evidence field rather than guessing missing values', () => {
        for (const key of Object.keys(task())) {
            const value: Record<string, unknown> = task(); delete value[key];
            expect(() => parseSlaPreviewSource({ ...source(), tasks: [value] }), key).toThrow(SlaPreviewProjectionError);
        }
    });
    it('bounds page/period counts and rejects inconsistent hasMore/duplicate tasks', () => {
        for (const tasks of [Array.from({ length: 21 }, () => task()), [task(), task()]]) expect(() => parseSlaPreviewSource({ ...source(), tasks })).toThrow(SlaPreviewProjectionError);
        expect(() => parseSlaPreviewSource({ ...source(), hasMore: true })).toThrow(SlaPreviewProjectionError);
        expect(() => parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), calendar: { ...calendar(), periods: Array.from({ length: 401 }, () => calendar().periods[0]) } }] })).toThrow(SlaPreviewProjectionError);
    });
    it('bounds coverage to positive maximum366days and interval endpoints', () => {
        for (const endsAt of ['2026-09-16T00:00:00Z', '2027-09-18T00:00:00Z']) {
            expect(() => parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), calendar: { ...calendar(), coverage: { ...calendar().coverage, endsAt } } }] })).toThrow(SlaPreviewProjectionError);
        }
        expect(() => parseSlaPreviewSource({ ...source(), tasks: [{ ...task(), calendar: { ...calendar(), periods: [{ ...calendar().periods[0], endsAt: calendar().periods[0].startsAt }] } }] })).toThrow(SlaPreviewProjectionError);
    });
});
describe('minimal dry-run public projection', () => {
    it('strips all raw/private source and never yields an emitter payload', () => {
        const expected = snapshot(); const value = { ...expected, settings: source().settings, source: source(), rows: [{ ...row(), calendar: calendar(), flags: task(), dedupeKey: 'private', phone: 'private' }] };
        expect(parseSlaPreviewSnapshot(value, 0, ADMIN)).toEqual(expected);
    });
    for (const reason of SLA_PREVIEW_REASONS) {
        if (['DUE_SOON', 'OVERDUE', 'NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS'].includes(reason)) continue;
        it(`accepts held ${reason} only with null computed fields`, () => {
            const held = { ...row(), state: 'held', reason, staffDueAt: null, notifyAt: null, rule: null, calendarVersion: null, notificationType: null };
            expect(parseSlaPreviewSnapshot({ ...snapshot(), rows: [held] }).rows[0]).toEqual(held);
            for (const key of ['staffDueAt', 'notifyAt', 'rule', 'calendarVersion', 'notificationType'] as const) {
                expect(() => parseSlaPreviewSnapshot({ ...snapshot(), rows: [{ ...held, [key]: row()[key] }] })).toThrow(SlaPreviewProjectionError);
            }
        });
    }
    it.each(['NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS'])('accepts scheduled %s even if past due outside shift', reason => {
        const scheduled = { ...row(), state: 'scheduled', reason, notificationType: null };
        expect(parseSlaPreviewSnapshot({ ...snapshot(), asOf: '2026-09-18T00:00:00Z', rows: [scheduled] }).rows[0]).toEqual(scheduled);
    });
    it.each(['state', 'reason', 'rule', 'notificationType'])('rejects unknown %s', field => expect(() => parseSlaPreviewSnapshot({ ...snapshot(), rows: [{ ...row(), [field]: 'unknown' }] })).toThrow(SlaPreviewProjectionError));
    it.each([{ state: 'held' }, { state: 'scheduled', reason: 'DUE_SOON', notificationType: null }, { state: 'scheduled', reason: 'NOT_DUE_YET' },
        { reason: 'OVERDUE', notificationType: 'due_soon' }, { reason: 'DUE_SOON', notificationType: 'overdue' }, { calendarVersion: null }, { ownerUserId: null, ownerName: null }])('rejects contradictory computed state %j', patch => {
        expect(() => parseSlaPreviewSnapshot({ ...snapshot(), rows: [{ ...row(), ...patch }] })).toThrow(SlaPreviewProjectionError);
    });
    it('uses exact microseconds at due boundary and thirty-minute warning window', () => {
        const overdue = { ...row(), reason: 'OVERDUE', notificationType: 'overdue' };
        expect(() => parseSlaPreviewSnapshot({ ...snapshot(), asOf: DUE, rows: [overdue] })).toThrow(SlaPreviewProjectionError);
        expect(parseSlaPreviewSnapshot({ ...snapshot(), asOf: '2026-09-17T03:00:00.123457Z', rows: [overdue] }).rows[0].notificationType).toBe('overdue');
        expect(() => parseSlaPreviewSnapshot({ ...snapshot(), asOf: '2026-09-17T02:30:00.123455Z' })).toThrow(SlaPreviewProjectionError);
        expect(parseSlaPreviewSnapshot({ ...snapshot(), asOf: '2026-09-17T02:30:00.123456Z' }).rows[0].notificationType).toBe('due_soon');
    });
    it.each([{ mode: 'live' }, { policyVersion: 'new' }, { dueSoonMinutes: 60 }, { pageSize: 50 }, { hasMore: true }, { actor: { userId: ADMIN, role: 'sales' } }])('rejects public contract mismatch %j', patch => {
        expect(() => parseSlaPreviewSnapshot({ ...snapshot(), ...patch })).toThrow(SlaPreviewProjectionError);
    });
    it('requires every public field and prevents duplicate task IDs', () => {
        for (const key of Object.keys(row())) { const value: Record<string, unknown> = row(); delete value[key]; expect(() => parseSlaPreviewSnapshot({ ...snapshot(), rows: [value] }), key).toThrow(SlaPreviewProjectionError); }
        expect(() => parseSlaPreviewSnapshot({ ...snapshot(), rows: [row(), row()] })).toThrow(SlaPreviewProjectionError);
    });
});
