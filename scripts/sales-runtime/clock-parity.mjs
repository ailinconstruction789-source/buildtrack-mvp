/** Isolated PostgreSQL runtime fixtures only. The caller supplies an already
 * isolated query function and the compiled, unchanged production TS helpers.
 * No connection, environment, filesystem, application or current clock access.
 */
import assert from 'node:assert/strict';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER_OWNER = '10000000-0000-4000-8000-000000000002';
const CALENDAR = '20000000-0000-4000-8000-000000000001';
const VERSION = '30000000-0000-4000-8000-000000000001';
const ANCHOR = '2026-09-15T10:00:00Z';
const SERVICE = '2026-09-16T10:00:00Z';
const DAY_WORK = [
    ['work', '2026-09-15T09:00:00Z', '2026-09-15T17:00:00Z'],
    ['work', '2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'],
];

function periods(rows) {
    return rows.map(([type, startsAt, endsAt], index) => ({
        id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        salesUserId: OWNER, type, startsAt, endsAt,
    }));
}

function ready(rule, staffDueAt, notifyAt, reason = 'NOT_DUE_YET', availableAt) {
    const result = { ready: true, reason, staffDueAt, notifyAt, rule };
    if (reason === 'DUE_SOON' || reason === 'OVERDUE') {
        result.notificationType = reason === 'DUE_SOON' ? 'due_soon' : 'overdue';
        result.availableAt = availableAt;
    }
    return result;
}

const held = reason => ({ ready: false, reason });
const direct = (reason = 'NOT_DUE_YET', availableAt) => ready('service_deadline', SERVICE, ANCHOR, reason, availableAt);

function fixture(label, overrides = {}) {
    const raw = {
        id: CALENDAR, version: VERSION, ownerUserId: OWNER,
        coverage: { startsAt: '2026-09-14T00:00:00Z', endsAt: '2026-09-20T00:00:00Z', complete: true },
        periods: periods(DAY_WORK),
        ...overrides.raw,
    };
    return {
        label, anchorAt: ANCHOR, serviceDueAt: SERVICE, asOf: '2026-09-16T09:00:00Z',
        dueSoonMinutes: 30, expected: direct(), parity: true, sqlOverrides: {},
        ...overrides, raw,
    };
}

function fixtures() {
    const cases = [
        fixture('in-hours anchor and service deadline retain original 24h deadline'),
        fixture('30m window has not started one microsecond early', {
            asOf: '2026-09-16T09:29:59.999999Z',
        }),
        fixture('30m window starts inclusively', {
            asOf: '2026-09-16T09:30:00Z', expected: direct('DUE_SOON', '2026-09-16T09:30:00Z'),
        }),
        fixture('exact staff deadline is still due-soon', {
            asOf: SERVICE, expected: direct('DUE_SOON', '2026-09-16T09:30:00Z'),
        }),
        fixture('one microsecond after deadline is overdue', {
            asOf: '2026-09-16T10:00:00.000001Z', expected: direct('OVERDUE', '2026-09-16T10:00:00.000001Z'),
        }),
        fixture('overdue remains unavailable for new delivery outside work', {
            asOf: '2026-09-16T18:00:00Z', expected: direct('OUTSIDE_WORKING_HOURS'),
        }),
        fixture('warning cannot be delivered during an approved break', {
            raw: { periods: periods([...DAY_WORK, ['break', '2026-09-16T09:20:00Z', '2026-09-16T09:40:00Z']]) },
            asOf: '2026-09-16T09:30:00Z', expected: direct('OUTSIDE_WORKING_HOURS'),
        }),
        fixture('warning availability resumes inclusively at break end', {
            raw: { periods: periods([...DAY_WORK, ['break', '2026-09-16T09:20:00Z', '2026-09-16T09:40:00Z']]) },
            asOf: '2026-09-16T09:40:00Z', expected: direct('DUE_SOON', '2026-09-16T09:40:00Z'),
        }),
        fixture('equivalent +07 offset preserves source service string', {
            anchorAt: '2026-09-15T17:00:00+07:00', serviceDueAt: '2026-09-16T17:00:00+07:00',
            asOf: '2026-09-16T16:30:00+07:00', expected: direct('DUE_SOON', '2026-09-16T09:30:00Z'),
        }),
        fixture('work start is inclusive for anchor and due', {
            anchorAt: '2026-09-15T09:00:00Z', serviceDueAt: '2026-09-16T09:00:00Z',
            asOf: '2026-09-16T09:00:00Z',
            expected: ready('service_deadline', '2026-09-16T09:00:00Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-16T09:00:00Z'),
        }),
        fixture('anchor at exclusive shift end starts next shift 120m', {
            anchorAt: '2026-09-15T17:00:00Z', serviceDueAt: '2026-09-16T17:00:00Z',
            asOf: '2026-09-16T10:30:00Z',
            expected: ready('out_of_hours', '2026-09-16T11:00:00Z', '2026-09-16T09:00:00Z', 'DUE_SOON', '2026-09-16T10:30:00Z'),
        }),
        fixture('in-hours service due at exclusive shift end defers 120m', {
            raw: { periods: periods([
                DAY_WORK[0], ['work', '2026-09-16T08:00:00Z', SERVICE],
                ['work', '2026-09-16T12:00:00Z', '2026-09-16T17:00:00Z'],
            ]) }, asOf: '2026-09-16T13:30:00Z',
            expected: ready('off_shift_service_deadline', '2026-09-16T14:00:00Z', ANCHOR, 'DUE_SOON', '2026-09-16T13:30:00Z'),
        }),
        fixture('in-hours service due inside break defers from break end', {
            raw: { periods: periods([...DAY_WORK, ['break', SERVICE, '2026-09-16T11:00:00Z']]) },
            asOf: '2026-09-16T12:30:00Z',
            expected: ready('off_shift_service_deadline', '2026-09-16T13:00:00Z', ANCHOR, 'DUE_SOON', '2026-09-16T12:30:00Z'),
        }),
        fixture('full approved leave defers service deadline until next day', {
            raw: { periods: periods([...DAY_WORK,
                ['leave', '2026-09-16T00:00:00Z', '2026-09-17T00:00:00Z'],
                ['work', '2026-09-17T09:00:00Z', '2026-09-17T17:00:00Z'],
            ]) }, asOf: '2026-09-17T10:30:00Z',
            expected: ready('off_shift_service_deadline', '2026-09-17T11:00:00Z', ANCHOR, 'DUE_SOON', '2026-09-17T10:30:00Z'),
        }),
        fixture('anchor in break is out of hours and excludes later breaks', {
            anchorAt: '2026-09-15T10:15:00Z', serviceDueAt: '2026-09-16T10:15:00Z',
            raw: { periods: periods([...DAY_WORK,
                ['break', '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z'],
                ['break', '2026-09-15T12:00:00Z', '2026-09-15T12:30:00Z'],
            ]) }, asOf: '2026-09-15T13:00:00Z',
            expected: ready('out_of_hours', '2026-09-15T13:30:00Z', '2026-09-15T11:00:00Z', 'DUE_SOON', '2026-09-15T13:00:00Z'),
        }),
        fixture('overlapping break and leave subtract union exactly once', {
            anchorAt: '2026-09-14T18:00:00Z', serviceDueAt: '2026-09-15T18:00:00Z',
            raw: { periods: periods([DAY_WORK[0],
                ['break', '2026-09-15T09:30:00Z', '2026-09-15T10:30:00Z'],
                ['leave', '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z'],
            ]) }, asOf: '2026-09-15T12:00:00Z',
            expected: ready('out_of_hours', '2026-09-15T12:30:00Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-15T12:00:00Z'),
        }),
        fixture('exclusion spanning coverage is safely clipped', {
            anchorAt: '2026-09-15T08:30:00Z', serviceDueAt: '2026-09-16T08:30:00Z',
            raw: {
                coverage: { startsAt: '2026-09-15T08:00:00Z', endsAt: '2026-09-17T00:00:00Z', complete: true },
                periods: periods([...DAY_WORK, ['leave', '2026-09-14T00:00:00Z', '2026-09-15T10:00:00Z']]),
            }, asOf: '2026-09-15T11:30:00Z',
            expected: ready('out_of_hours', '2026-09-15T12:00:00Z', '2026-09-15T10:00:00Z', 'DUE_SOON', '2026-09-15T11:30:00Z'),
        }),
        fixture('adjacent periods accumulate through boundary', {
            anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
            raw: { periods: periods([
                ['work', '2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z'],
                ['work', '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z'], DAY_WORK[1],
            ]) }, asOf: '2026-09-15T10:30:00Z',
            expected: ready('out_of_hours', '2026-09-15T11:00:00Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-15T10:30:00Z'),
        }),
        fixture('overnight shift crosses midnight with exact 120m', {
            anchorAt: '2026-09-15T20:00:00Z', serviceDueAt: '2026-09-16T20:00:00Z',
            raw: { periods: periods([['work', '2026-09-15T22:00:00Z', '2026-09-16T02:00:00Z']]) },
            asOf: '2026-09-15T23:30:00Z',
            expected: ready('out_of_hours', '2026-09-16T00:00:00Z', '2026-09-15T22:00:00Z', 'DUE_SOON', '2026-09-15T23:30:00Z'),
        }),
        fixture('120 actual minutes can span multiple work days', {
            anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
            raw: { periods: periods([
                ['work', '2026-09-15T09:00:00Z', '2026-09-15T09:45:00Z'],
                ['work', '2026-09-16T09:00:00Z', '2026-09-16T10:15:00Z'],
            ]) }, asOf: '2026-09-16T09:45:00Z',
            expected: ready('out_of_hours', '2026-09-16T10:15:00Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-16T09:45:00Z'),
        }),
        fixture('deadline at coverage end is permitted when work sufficient', {
            anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
            raw: {
                coverage: { startsAt: '2026-09-14T00:00:00Z', endsAt: '2026-09-15T11:00:00Z', complete: true },
                periods: periods([['work', '2026-09-15T09:00:00Z', '2026-09-15T11:00:00Z']]),
            }, asOf: '2026-09-15T10:30:00Z',
            expected: ready('out_of_hours', '2026-09-15T11:00:00Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-15T10:30:00Z'),
        }),
        fixture('one microsecond gap at service due is off shift', {
            raw: { periods: periods([DAY_WORK[0],
                ['work', '2026-09-16T09:00:00Z', SERVICE],
                ['work', '2026-09-16T10:00:00.000001Z', '2026-09-16T17:00:00Z'],
            ]) }, asOf: '2026-09-16T11:30:00.000001Z',
            expected: ready('off_shift_service_deadline', '2026-09-16T12:00:00.000001Z', ANCHOR, 'DUE_SOON', '2026-09-16T11:30:00.000001Z'),
        }),
        fixture('fractional split keeps the final one microsecond', {
            anchorAt: '2026-09-14T20:00:00.123456Z', serviceDueAt: '2026-09-15T20:00:00.123456Z',
            raw: { periods: periods([
                ['work', '2026-09-15T09:00:00Z', '2026-09-15T09:59:59.999999Z'],
                ['work', '2026-09-15T10:15:00Z', '2026-09-15T13:00:00Z'],
            ]) }, asOf: '2026-09-15T10:45:00.000001Z',
            expected: ready('out_of_hours', '2026-09-15T11:15:00.000001Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-15T10:45:00.000001Z'),
        }),
        fixture('empty complete calendar does not invent work', {
            raw: { periods: [] }, expected: held('INSUFFICIENT_COVERAGE'),
        }),
        fixture('incomplete coverage stays held', {
            raw: { coverage: { startsAt: '2026-09-14T00:00:00Z', endsAt: '2026-09-20T00:00:00Z', complete: false } },
            expected: held('INSUFFICIENT_COVERAGE'),
        }),
        fixture('overlapping work is rejected rather than counted twice', {
            raw: { periods: periods([...DAY_WORK, ['work', '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z']]) },
            expected: held('INVALID_CALENDAR'),
        }),
        fixture('mixed-owner source period is rejected', {
            raw: { periods: periods(DAY_WORK).map((row, i) => i === 0 ? { ...row, salesUserId: OTHER_OWNER } : row) },
            expected: held('INVALID_CALENDAR'),
        }),
        fixture('duplicate source IDs are rejected', {
            raw: { periods: periods(DAY_WORK).map((row, i, all) => i === 1 ? { ...row, id: all[0].id } : row) },
            expected: held('INVALID_CALENDAR'),
        }),
        fixture('invalid period type is rejected', {
            raw: { periods: periods([['holiday', '2026-09-15T09:00:00Z', '2026-09-15T17:00:00Z']]) },
            expected: held('INVALID_CALENDAR'),
        }),
        fixture('zero-length source interval is rejected', {
            raw: { periods: periods([['work', ANCHOR, ANCHOR]]) }, expected: held('INVALID_CALENDAR'),
        }),
        fixture('work outside complete coverage is rejected not clipped', {
            raw: { periods: periods([...DAY_WORK, ['work', '2026-09-13T23:00:00Z', '2026-09-14T01:00:00Z']]) },
            expected: held('INVALID_CALENDAR'),
        }),
        fixture('anchor outside coverage is held', {
            anchorAt: '2026-09-13T20:00:00Z', serviceDueAt: '2026-09-14T20:00:00Z',
            expected: held('INSUFFICIENT_COVERAGE'),
        }),
        fixture('in-hours service deadline outside coverage is held', {
            serviceDueAt: '2026-09-20T10:00:00Z', expected: held('INSUFFICIENT_COVERAGE'),
        }),
        fixture('insufficient future actual work stays held', {
            anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
            raw: { periods: periods([['work', '2026-09-15T09:00:00Z', '2026-09-15T10:59:59.999999Z']]) },
            asOf: '2026-09-15T10:00:00Z', expected: held('INSUFFICIENT_COVERAGE'),
        }),
        fixture('service deadline before anchor is rejected', {
            serviceDueAt: '2026-09-15T09:59:59.999999Z', expected: held('SOURCE_TIME_REVIEW'),
        }),
        fixture('infinite service timestamp is rejected', {
            serviceDueAt: 'infinity', expected: held('SOURCE_TIME_REVIEW'),
        }),
        fixture('infinite coverage is rejected', {
            raw: { coverage: { startsAt: '-infinity', endsAt: 'infinity', complete: true } },
            expected: held('INVALID_CALENDAR'),
        }),
        fixture('missing owner is rejected', {
            raw: { ownerUserId: null }, expected: held('INVALID_CALENDAR'),
        }),
        // These are SQL-only boundaries: the TS staff clock has no current-time
        // or warning-policy input, and its pure calendar bound is 10,000/uncapped
        // days rather than the SQL publication bound of 400/366 days.
        fixture('server evaluation at exclusive coverage end is held', {
            asOf: '2026-09-20T00:00:00Z', expected: held('INSUFFICIENT_COVERAGE'), parity: false,
        }),
        fixture('future anchor relative to server time is held', {
            asOf: '2026-09-15T09:59:59.999999Z', expected: held('SOURCE_TIME_REVIEW'), parity: false,
        }),
        fixture('367-day published coverage is rejected', {
            raw: { coverage: { startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-03T00:00:00Z', complete: true } },
            expected: held('INVALID_CALENDAR'), parity: false,
        }),
        fixture('negative warning minutes are rejected', {
            dueSoonMinutes: -1, expected: held('POLICY_REVIEW'), parity: false,
        }),
        fixture('warning minutes above helper bound are rejected', {
            dueSoonMinutes: 1441, expected: held('POLICY_REVIEW'), parity: false,
        }),
        fixture('null source arrays cannot imply empty complete calendar', {
            sqlOverrides: { ids: 'NULL::uuid[]' }, expected: held('INVALID_CALENDAR'), parity: false,
        }),
        fixture('mismatched source-array sizes are rejected', {
            sqlOverrides: { owners: `ARRAY['${OWNER}'::uuid]` }, expected: held('INVALID_CALENDAR'), parity: false,
        }),
        fixture('null source-array element is rejected', {
            sqlOverrides: { types: "ARRAY['work',NULL]::text[]" }, expected: held('INVALID_CALENDAR'), parity: false,
        }),
        fixture('non-one-based source arrays are rejected', {
            sqlOverrides: { ids: "'[0:1]={40000000-0000-4000-8000-000000000001,40000000-0000-4000-8000-000000000002}'::uuid[]" },
            expected: held('INVALID_CALENDAR'), parity: false,
        }),
        fixture('multidimensional source arrays are rejected', {
            sqlOverrides: { ids: "ARRAY[ARRAY['40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002']]::uuid[]" },
            expected: held('INVALID_CALENDAR'), parity: false,
        }),
    ];

    const microWork = periods([['work', '2026-09-15T09:00:00.000001Z', '2026-09-15T17:00:00.000001Z']]);
    const microDue = '2026-09-15T11:00:00.000001Z';
    const microNotify = '2026-09-15T09:00:00.000001Z';
    for (const [name, asOf, reason, available] of [
        ['before fractional warning', '2026-09-15T10:30:00.000000Z', 'NOT_DUE_YET'],
        ['at fractional warning', '2026-09-15T10:30:00.000001Z', 'DUE_SOON', '2026-09-15T10:30:00.000001Z'],
        ['at fractional deadline', microDue, 'DUE_SOON', '2026-09-15T10:30:00.000001Z'],
        ['after fractional deadline', '2026-09-15T11:00:00.000002Z', 'OVERDUE', '2026-09-15T11:00:00.000002Z'],
    ]) cases.push(fixture(name, {
        anchorAt: '2026-09-14T20:00:00.123456Z', serviceDueAt: '2026-09-15T20:00:00.123456Z',
        raw: { periods: microWork }, asOf, expected: ready('out_of_hours', microDue, microNotify, reason, available),
    }));

    const shortShift = periods([['work', '2026-09-15T09:00:00Z', '2026-09-15T11:00:00Z'], DAY_WORK[1]]);
    cases.push(fixture('deadline at exclusive shift end cannot emit then', {
        anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
        raw: { periods: shortShift }, asOf: '2026-09-15T11:00:00Z',
        expected: ready('out_of_hours', '2026-09-15T11:00:00Z', '2026-09-15T09:00:00Z', 'OUTSIDE_WORKING_HOURS'),
    }));
    cases.push(fixture('overdue availability resumes at next actual shift', {
        anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
        raw: { periods: shortShift }, asOf: '2026-09-16T09:00:00Z',
        expected: ready('out_of_hours', '2026-09-15T11:00:00Z', '2026-09-15T09:00:00Z', 'OVERDUE', '2026-09-16T09:00:00Z'),
    }));

    const boundRows = [['work', '2026-09-15T09:00:00Z', '2026-09-15T17:00:00Z']];
    for (let index = 1; index < 401; index++) boundRows.push(['break', '2026-09-15T02:00:00Z', '2026-09-15T03:00:00Z']);
    cases.push(fixture('exactly 400 valid published source periods are accepted', {
        anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
        raw: { periods: periods(boundRows.slice(0, 400)) }, asOf: '2026-09-15T10:30:00Z',
        expected: ready('out_of_hours', '2026-09-15T11:00:00Z', '2026-09-15T09:00:00Z', 'DUE_SOON', '2026-09-15T10:30:00Z'),
    }));
    cases.push(fixture('401 source periods exceed SQL publication bound', {
        raw: { periods: periods(boundRows) }, expected: held('INVALID_CALENDAR'), parity: false,
    }));

    // Deterministic generated cases with an independently known union duration.
    // [09:30,10:00+i) U [09:45,10:15+i) removes exactly 45+i minutes.
    // A fractional work start therefore gives staff due 11:45+i plus the SAME
    // microsecond fraction; each now is exactly the 30-minute warning boundary.
    const minuteTime = (minute, fraction = '000000') => `2026-09-15T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.${fraction}Z`;
    for (let index = 0; index < 24; index++) {
        const fraction = String(index + 1).padStart(6, '0');
        const due = minuteTime(11 * 60 + 45 + index, fraction);
        const available = minuteTime(11 * 60 + 15 + index, fraction);
        const workStart = minuteTime(9 * 60, fraction);
        const source = periods([
            ['work', workStart, minuteTime(17 * 60, fraction)],
            ['break', minuteTime(9 * 60 + 30), minuteTime(10 * 60 + index)],
            ['leave', minuteTime(9 * 60 + 45), minuteTime(10 * 60 + 15 + index)],
        ]);
        if (index % 2) source.reverse(); // Input ordering must not change the union.
        cases.push(fixture(`generated overlap/microsecond ${index + 1}`, {
            anchorAt: '2026-09-14T20:00:00Z', serviceDueAt: '2026-09-15T20:00:00Z',
            raw: { periods: source }, asOf: available,
            expected: ready('out_of_hours', due, workStart, 'DUE_SOON', available),
        }));
    }
    return cases;
}

const literal = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const typed = (value, type) => `${literal(value)}::${type}`;
const array = (values, type) => `ARRAY[${values.map(value => literal(value)).join(',')}]::${type}[]`;

function sqlCall(item) {
    const { raw } = item;
    const arrays = {
        ids: array(raw.periods.map(row => row.id), 'uuid'),
        owners: array(raw.periods.map(row => row.salesUserId), 'uuid'),
        types: array(raw.periods.map(row => row.type), 'text'),
        starts: array(raw.periods.map(row => row.startsAt), 'timestamptz'),
        ends: array(raw.periods.map(row => row.endsAt), 'timestamptz'),
        ...item.sqlOverrides,
    };
    return `sales_private.crm_first_contact_clock(${[
        typed(item.anchorAt, 'timestamptz'), typed(item.serviceDueAt, 'timestamptz'), typed(raw.ownerUserId, 'uuid'),
        typed(raw.coverage.startsAt, 'timestamptz'), typed(raw.coverage.endsAt, 'timestamptz'),
        raw.coverage.complete ? 'true' : 'false', arrays.ids, arrays.owners, arrays.types, arrays.starts, arrays.ends,
        typed(item.asOf, 'timestamptz'), `${item.dueSoonMinutes}::integer`,
    ].join(',')})`;
}

function freezeTree(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freezeTree(child);
        Object.freeze(value);
    }
    return value;
}

/** @param {{query: (sql: string) => Promise<string>, prepareSlaWorkCalendar: Function,
 * calculateInitialContactStaffDeadline: Function, parseEvidenceTimestamp: Function}} dependencies
 * @returns {Promise<{cases: number, parityCases: number, notificationCases: number, labels: string[]}>}
 */
export async function runClockParity({ query, prepareSlaWorkCalendar, calculateInitialContactStaffDeadline, parseEvidenceTimestamp }) {
    for (const dependency of [query, prepareSlaWorkCalendar, calculateInitialContactStaffDeadline, parseEvidenceTimestamp]) {
        assert.equal(typeof dependency, 'function', 'clock parity requires all injected dependencies');
    }
    const cases = fixtures();
    assert.equal(new Set(cases.map(item => item.label)).size, cases.length, 'fixture labels must be unique');
    // One SELECT; no writes or connection setup. Feed via stdin, not a Windows
    // command-line argument: the 400/401-row fixtures exceed command-line limits.
    const sql = `SELECT jsonb_agg(jsonb_build_object('label',label,'result',result) ORDER BY ordinal)::text
FROM (VALUES ${cases.map((item, index) => `(${index},${literal(item.label)},${sqlCall(item)})`).join(',\n')}) AS fixture(ordinal,label,result);`;
    const stdout = await query(sql);
    assert.equal(typeof stdout, 'string', 'query must return raw psql -At stdout');
    let results;
    try { results = JSON.parse(stdout.trim()); }
    catch (error) { throw new Error('Clock parity query did not return one JSON array', { cause: error }); }
    assert.ok(Array.isArray(results), 'clock parity query result must be an array');
    assert.equal(results.length, cases.length, 'native clock returned every fixture');

    function sameInstant(actual, expected, context) {
        const actualTime = parseEvidenceTimestamp(actual), expectedTime = parseEvidenceTimestamp(expected);
        assert.equal(typeof actualTime, 'bigint', `${context}: actual must be an exact valid timestamp`);
        assert.equal(typeof expectedTime, 'bigint', `${context}: expected fixture must be a valid timestamp`);
        assert.equal(actualTime, expectedTime, `${context}: exact microseconds`);
    }

    let parityCases = 0;
    let notificationCases = 0;
    for (const [index, item] of cases.entries()) {
        const entry = results[index];
        assert.equal(entry.label, item.label, `fixture ${index}: stable result association`);
        const result = entry.result;
        assert.ok(result && typeof result === 'object' && !Array.isArray(result), `${item.label}: result object`);
        assert.deepEqual(Object.keys(result).sort(), Object.keys(item.expected).sort(), `${item.label}: exact SQL output shape`);
        for (const [key, expected] of Object.entries(item.expected)) {
            if (['staffDueAt', 'notifyAt', 'availableAt'].includes(key)) sameInstant(result[key], expected, `${item.label}/${key}`);
            else assert.equal(result[key], expected, `${item.label}/${key}`);
        }
        if (result.ready) {
            notificationCases++;
            if (result.notificationType) {
                const now = parseEvidenceTimestamp(item.asOf), due = parseEvidenceTimestamp(result.staffDueAt);
                assert.ok(parseEvidenceTimestamp(result.availableAt) <= now, `${item.label}: availability never in future`);
                assert.ok(result.notificationType === 'overdue' ? now > due : now <= due, `${item.label}: inclusive due/strict overdue boundary`);
            } else assert.ok(['NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS'].includes(result.reason), `${item.label}: no invented delivery`);
        }
        if (!item.parity) continue;
        parityCases++;
        const input = freezeTree({
            anchorAt: item.anchorAt, serviceDueAt: item.serviceDueAt, ownerUserId: item.raw.ownerUserId,
            ownership: 'unchanged', calendar: null,
            policy: { approval: 'approved', version: 'first_contact_processing_v1', workingMinutes: 120 },
        });
        const sourceBefore = JSON.stringify(item.raw);
        const prepared = prepareSlaWorkCalendar(freezeTree(item.raw));
        assert.equal(JSON.stringify(item.raw), sourceBefore, `${item.label}: preparation does not mutate source evidence`);
        if (prepared.state !== 'ready') {
            assert.equal(result.ready, false, `${item.label}: invalid/incomplete calendar cannot become SQL ready`);
            continue;
        }
        const staffInput = freezeTree({ ...input, calendar: prepared.calendar });
        const inputBefore = JSON.stringify(staffInput);
        const calculated = calculateInitialContactStaffDeadline(staffInput);
        assert.equal(JSON.stringify(staffInput), inputBefore, `${item.label}: TS staff clock does not mutate source`);
        assert.equal(result.ready, calculated.state === 'ready', `${item.label}: native/TS readiness parity`);
        if (calculated.state === 'ready') {
            assert.equal(result.rule, calculated.rule, `${item.label}: native/TS approved rule parity`);
            sameInstant(result.staffDueAt, calculated.staffDueAt, `${item.label}: native/TS staff deadline`);
            sameInstant(result.notifyAt, calculated.notifyAt, `${item.label}: native/TS notify anchor`);
            assert.equal(calculated.serviceDueAt, item.serviceDueAt, `${item.label}: original service string stays unchanged`);
            assert.equal(calculated.anchorAt, item.anchorAt, `${item.label}: original anchor stays unchanged`);
        }
    }
    return { cases: cases.length, parityCases, notificationCases, labels: cases.map(item => item.label) };
}
