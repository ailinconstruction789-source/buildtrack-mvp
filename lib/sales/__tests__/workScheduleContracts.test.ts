import { describe, expect, it } from 'vitest';
import { parseWorkScheduleInput, parseWorkScheduleQuery, parseWorkScheduleResult, parseWorkScheduleSnapshot,
    WorkScheduleInputError, WorkScheduleProjectionError } from '../workScheduleContracts';

const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const SALES = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002';
const CALENDAR = '00000000-0000-4000-8000-000000000003';
const VERSION = '00000000-0000-4000-8000-000000000004';
const PERIOD = '00000000-0000-4000-8000-000000000005';
const NEXT = '00000000-0000-4000-8000-000000000006';
const coverage = { startsAt: '2026-09-16T00:00:00.000001+07:00', endsAt: '2026-09-17T00:00:00.000001+07:00' };
const work = { type: 'work', startsAt: '2026-09-16T09:00:00.123456+07:00', endsAt: '2026-09-16T17:00:00.123456+07:00' };
const input = { requestId: REQUEST, salesUserId: SALES, expectedVersion: null, coverage, periods: [work], confirmedComplete: true, reason: ' รับรองตารางงาน ' };
function snapshot(selected: string | null = SALES) {
    return { actor: { userId: ADMIN, role: 'admin' }, asOf: '2026-09-16T12:00:00.979649+07:00',
        sales: [{ userId: SALES, displayName: null }], salesHasMore: false, selectedSalesUserId: selected,
        calendar: selected === null ? null : { raw: { id: CALENDAR, version: VERSION, ownerUserId: SALES,
            coverage: { ...coverage, complete: true }, periods: [{ ...work, id: PERIOD, salesUserId: SALES }] },
        publishedAt: '2026-09-16T12:00:00.979648+07:00', publishedByUserId: ADMIN, changeReason: 'รับรองตารางงาน' } };
}

describe('work-schedule command contract', () => {
    it('normalizes IDs/reason, preserves exact times, and does not mutate or invent row IDs', () => {
        const original = JSON.stringify(input);
        const result = parseWorkScheduleInput({ ...input, salesUserId: ADMIN.toUpperCase(), expectedVersion: ADMIN.toUpperCase() });
        expect(result).toEqual({ ...input, salesUserId: ADMIN, expectedVersion: ADMIN, reason: input.reason.trim() });
        expect(Object.keys(result.periods[0])).toEqual(['type', 'startsAt', 'endsAt']); expect(JSON.stringify(input)).toBe(original);
    });
    it('allows explicit known-no-work coverage and fully excluded work, but never assumes confirmation', () => {
        expect(parseWorkScheduleInput({ ...input, periods: [] }).periods).toEqual([]);
        expect(parseWorkScheduleInput({ ...input, periods: [work, { ...work, type: 'leave' }] }).periods).toHaveLength(2);
        for (const confirmedComplete of [false, null, undefined, 'true', 1]) {
            expect(() => parseWorkScheduleInput({ ...input, confirmedComplete })).toThrow(WorkScheduleInputError);
        }
    });
    it('permits historical/future version coverage without resetting or evaluating any SLA clock', () => {
        for (const year of ['1900', '2099']) {
            expect(parseWorkScheduleInput({ ...input, coverage: { startsAt: `${year}-01-01T00:00:00Z`, endsAt: `${year}-01-02T00:00:00Z` }, periods: [] })).toMatchObject({ confirmedComplete: true });
        }
    });
    it.each(['requestId', 'salesUserId', 'expectedVersion', 'coverage', 'periods', 'confirmedComplete', 'reason'])('requires own key %s', key => {
        const value: Record<string, unknown> = { ...input }; delete value[key];
        expect(() => parseWorkScheduleInput(value)).toThrow();
        expect(() => parseWorkScheduleInput(Object.assign(Object.create({ [key]: input[key as keyof typeof input] }), value))).toThrow();
    });
    it.each(['actor', 'role', 'ownerUserId', 'publishedAt', 'publishedByUserId', 'version', 'calendarId', 'staffDueAt', 'kpiCredit', '__proto__'])('rejects injected root %s', key => {
        expect(() => parseWorkScheduleInput({ ...input, [key]: 'untrusted' })).toThrow();
    });
    it('rejects nested IDs, completeness claims on coverage, and extra row fields', () => {
        for (const key of ['id', 'salesUserId', 'approved', 'ownerUserId', '__proto__']) {
            expect(() => parseWorkScheduleInput({ ...input, periods: [{ ...work, [key]: SALES }] })).toThrow();
        }
        expect(() => parseWorkScheduleInput({ ...input, coverage: { ...coverage, complete: true } })).toThrow();
    });
    it.each([null, [], {}, 'input', 0])('rejects malformed root %j', value => { expect(() => parseWorkScheduleInput(value)).toThrow(); });
    it.each(['requestId', 'salesUserId', 'expectedVersion'])('rejects malformed UUID in %s', field => {
        for (const value of [undefined, '', 'bad', `${ADMIN}\n`, `${ADMIN}\r`, ` ${ADMIN}`]) {
            expect(() => parseWorkScheduleInput({ ...input, [field]: value })).toThrow();
        }
    });
    it.each(['\u0000', '\t', '\n', '\r', '\u001f', '\u007f', '\u0085', '\u009f', '\u2028', '\u2029', '\ud800', '\udfff'])('rejects invalid single-line Unicode %j before trimming', character => {
        expect(() => parseWorkScheduleInput({ ...input, reason: `เหตุผล${character}` })).toThrow();
        expect(() => parseWorkScheduleInput({ ...input, reason: character })).toThrow();
    });
    it('counts code points, allows valid emoji, and rejects missing/blank/overlong reason', () => {
        expect(parseWorkScheduleInput({ ...input, reason: ` ${'🙏'.repeat(1000)} ` }).reason).toBe('🙏'.repeat(1000));
        for (const reason of [null, undefined, 1, '', '   ', 'ก'.repeat(1001)]) expect(() => parseWorkScheduleInput({ ...input, reason })).toThrow();
    });
    it.each(['2026-02-30T00:00:00Z', '2026-09-16T24:00:00Z', '2026-09-16T12:00:60Z', '2026-09-16T12:00:00',
        '2026-09-16T12:00:00-00:00', '2026-09-16T12:00:00.1234567Z', '2026-09-16T12:00:00Z\n',
        '2026-09-16T12:00:00Z\r', '2026-09-16T12:00:00Z\r\n', '2026-09-16T12:00:00Z\u2028',
        '2026-09-16T12:00:00Z\u2029', ' 2026-09-16T12:00:00Z', '0001-01-01T00:00:00+07:00'])('rejects invalid timestamp %j', startsAt => {
        expect(() => parseWorkScheduleInput({ ...input, periods: [{ ...work, startsAt }] })).toThrow();
        expect(() => parseWorkScheduleInput({ ...input, coverage: { ...coverage, startsAt } })).toThrow();
    });
    it('enforces 366 actual elapsed days exactly, including microseconds and offsets', () => {
        const startsAt = '2026-01-01T00:00:00.000001+07:00';
        expect(parseWorkScheduleInput({ ...input, periods: [], coverage: { startsAt, endsAt: '2027-01-02T00:00:00.000001+07:00' } })).toBeDefined();
        for (const endsAt of ['2027-01-02T00:00:00.000002+07:00', '2027-01-02T00:00:00.000001+06:00', startsAt, '2025-01-01T00:00:00Z']) {
            expect(() => parseWorkScheduleInput({ ...input, periods: [], coverage: { startsAt, endsAt } })).toThrow();
        }
    });
    it('rejects work outside coverage and overlapping work, but permits adjacent intervals', () => {
        expect(() => parseWorkScheduleInput({ ...input, periods: [work, work] })).toThrow();
        expect(() => parseWorkScheduleInput({ ...input, periods: [{ ...work, startsAt: '2026-09-15T09:00:00Z' }] })).toThrow();
        expect(() => parseWorkScheduleInput({ ...input, periods: [{ ...work, endsAt: '2026-09-18T09:00:00Z' }] })).toThrow();
        expect(parseWorkScheduleInput({ ...input, periods: [work, { ...work, startsAt: work.endsAt, endsAt: '2026-09-16T18:00:00+07:00' }] }).periods).toHaveLength(2);
    });
    it('preserves approved exclusion union/span/outside-coverage semantics rather than clipping work', () => {
        const exclusions = [
            { type: 'leave', startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-18T00:00:00Z' },
            { type: 'break', startsAt: '2026-09-16T10:00:00+07:00', endsAt: '2026-09-16T13:00:00+07:00' },
            { type: 'leave', startsAt: '2026-09-10T00:00:00Z', endsAt: '2026-09-11T00:00:00Z' },
        ];
        expect(parseWorkScheduleInput({ ...input, periods: [work, ...exclusions] }).periods).toEqual([work, ...exclusions]);
    });
    it('limits raw rows to 400 including excluded periods and rejects malformed rows', () => {
        const rows = Array.from({ length: 400 }, () => ({ ...work, type: 'break' }));
        expect(parseWorkScheduleInput({ ...input, periods: rows }).periods).toHaveLength(400);
        expect(() => parseWorkScheduleInput({ ...input, periods: [...rows, work] })).toThrow();
        for (const row of [null, {}, { ...work, type: 'holiday' }, { ...work, endsAt: work.startsAt }]) {
            expect(() => parseWorkScheduleInput({ ...input, periods: [row] })).toThrow();
        }
    });
});

describe('schedule query and snapshot projection', () => {
    it('accepts only absent or one nonblank Sales UUID', () => {
        expect(parseWorkScheduleQuery('https://app.test/api')).toBeNull();
        expect(parseWorkScheduleQuery(`https://app.test/api?salesUserId=${ADMIN.toUpperCase()}`)).toBe(ADMIN);
        for (const query of ['salesUserId=', 'salesUserId=bad', `salesUserId=${SALES}&salesUserId=${SALES}`, `salesUserId=${SALES}&role=admin`, `salesUserId=${SALES}%0A`]) {
            expect(() => parseWorkScheduleQuery(`https://app.test/api?${query}`)).toThrow(WorkScheduleInputError);
        }
    });
    it('projects exact public fields, normalizes identities and preserves nullable names and time precision', () => {
        const data = snapshot();
        const raw = { ...data, privateDump: 'hidden', actor: { ...data.actor, userId: ADMIN.toUpperCase(), roleMetadata: 'hidden' },
            calendar: { ...data.calendar!, privateDump: 'hidden', raw: { ...data.calendar!.raw, privateDump: 'hidden',
                periods: data.calendar!.raw.periods.map(row => ({ ...row, privateDump: 'hidden' })) } } };
        const serialized = JSON.stringify(raw);
        expect(parseWorkScheduleSnapshot(raw, SALES)).toEqual(data); expect(JSON.stringify(raw)).toBe(serialized);
    });
    it('accepts an unselected screen or a selected Sales without published calendar, but never auto-selects', () => {
        expect(parseWorkScheduleSnapshot(snapshot(null), null).calendar).toBeNull();
        expect(parseWorkScheduleSnapshot({ ...snapshot(), calendar: null }, SALES).calendar).toBeNull();
        expect(() => parseWorkScheduleSnapshot(snapshot(), null)).toThrow();
        expect(() => parseWorkScheduleSnapshot(snapshot(null), SALES)).toThrow();
    });
    it('requires selected candidate membership and binds calendar/period owner to selected Sales', () => {
        const data = snapshot();
        expect(() => parseWorkScheduleSnapshot({ ...data, sales: [] })).toThrow();
        expect(() => parseWorkScheduleSnapshot(data, ADMIN)).toThrow();
        expect(() => parseWorkScheduleSnapshot({ ...data, calendar: { ...data.calendar, raw: { ...data.calendar!.raw, ownerUserId: ADMIN } } })).toThrow();
        expect(() => parseWorkScheduleSnapshot({ ...data, calendar: { ...data.calendar, raw: { ...data.calendar!.raw, periods: [{ ...data.calendar!.raw.periods[0], salesUserId: ADMIN }] } } })).toThrow();
    });
    it('rejects incomplete/overlapping/malformed raw calendars, including duplicate row IDs', () => {
        const data = snapshot(), raw = data.calendar!.raw;
        for (const invalid of [{ ...raw, id: 'bad' }, { ...raw, version: null }, { ...raw, coverage: { ...raw.coverage, complete: false } },
            { ...raw, periods: [raw.periods[0], raw.periods[0]] }, { ...raw, periods: [{ ...raw.periods[0], id: 'bad' }] }]) {
            expect(() => parseWorkScheduleSnapshot({ ...data, calendar: { ...data.calendar, raw: invalid } })).toThrow(WorkScheduleProjectionError);
        }
    });
    it('checks publication not later than asOf to the exact microsecond, without comparing coverage to now', () => {
        const data = snapshot();
        expect(() => parseWorkScheduleSnapshot({ ...data, calendar: { ...data.calendar, publishedAt: '2026-09-16T12:00:00.979650+07:00' } })).toThrow();
        expect(parseWorkScheduleSnapshot({ ...data, calendar: { ...data.calendar, publishedAt: data.asOf } }).calendar!.publishedAt).toBe(data.asOf);
    });
    it.each(['owner', 'sales', '', null])('rejects non-Admin actor %j', role => { expect(() => parseWorkScheduleSnapshot({ ...snapshot(), actor: { userId: ADMIN, role } })).toThrow(); });
    it.each(['actor', 'asOf', 'sales', 'salesHasMore', 'selectedSalesUserId', 'calendar'])('requires snapshot field %s', field => {
        const data: Record<string, unknown> = { ...snapshot() }; delete data[field]; expect(() => parseWorkScheduleSnapshot(data)).toThrow();
    });
    it('caps candidates at 200, binds truncation to a full list, and rejects duplicate normalized IDs', () => {
        const sales = Array.from({ length: 200 }, (_, i) => ({ userId: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`, displayName: null }));
        expect(parseWorkScheduleSnapshot({ ...snapshot(null), sales, salesHasMore: true }).sales).toHaveLength(200);
        expect(() => parseWorkScheduleSnapshot({ ...snapshot(null), sales: [...sales, { userId: ADMIN, displayName: null }] })).toThrow();
        expect(() => parseWorkScheduleSnapshot({ ...snapshot(null), salesHasMore: true })).toThrow();
        expect(() => parseWorkScheduleSnapshot({ ...snapshot(null), sales: [{ userId: ADMIN, displayName: null }, { userId: ADMIN.toUpperCase(), displayName: null }] })).toThrow();
        expect(() => parseWorkScheduleSnapshot({ ...snapshot(null), sales: Array(1) })).toThrow();
    });
});

describe('schedule publish result', () => {
    const result = { calendarId: CALENDAR, version: NEXT, salesUserId: SALES, replayed: false };
    it('projects only strict UUIDs/result fields with exact target and changed version', () => {
        expect(parseWorkScheduleResult({ ...result, privateDump: 'hidden' }, { salesUserId: SALES, expectedVersion: VERSION })).toEqual(result);
        expect(parseWorkScheduleResult({ ...result, salesUserId: ADMIN.toUpperCase(), replayed: true }, { salesUserId: ADMIN, expectedVersion: null }).salesUserId).toBe(ADMIN);
    });
    it.each([null, [], {}, { ...result, calendarId: 'bad' }, { ...result, version: VERSION }, { ...result, version: `${NEXT}\n` },
        { ...result, salesUserId: ADMIN }, { ...result, replayed: 1 }])('rejects malformed/unbound success %j as uncertain projection error', value => {
        expect(() => parseWorkScheduleResult(value, { salesUserId: SALES, expectedVersion: VERSION })).toThrow(WorkScheduleProjectionError);
    });
});
