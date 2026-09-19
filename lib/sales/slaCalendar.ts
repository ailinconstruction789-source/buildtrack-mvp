/**
 * PURE preparation of a trusted, versioned roster snapshot for slaClock.
 * The caller must establish the owner's identity and positively attest complete
 * coverage of actual work and APPROVED leave/break periods. Passing browser data
 * here cannot authenticate it, approve leave, establish a roster, or grant rights.
 *
 * No default shift, weekend rule, current time, persistence, deadline, notification,
 * customer data or staff score is introduced. Incomplete evidence stays not_ready.
 */
import { parseEvidenceTimestamp } from './leadEvidence';
import type { SlaWorkCalendar, SlaWorkPeriod } from './slaClock';

export interface RawSlaWorkPeriod {
    readonly id: string;
    readonly salesUserId: string;
    readonly type: 'work' | 'leave' | 'break';
    readonly startsAt: string;
    readonly endsAt: string;
}

export interface RawSlaWorkCalendar {
    readonly id: string;
    readonly version: string;
    readonly ownerUserId: string;
    /** Complete means all work and approved exclusions in this half-open range. */
    readonly coverage: { readonly startsAt: string; readonly endsAt: string; readonly complete: boolean };
    readonly periods: readonly RawSlaWorkPeriod[];
}

/** Minimal lineage within calendar id/version; deliberately no exclusion details. */
export interface SlaWorkPeriodLineage {
    readonly workPeriodId: string;
    readonly sourcePeriodId: string;
}

export type PrepareSlaWorkCalendarResult =
    | { readonly state: 'ready'; readonly calendar: SlaWorkCalendar; readonly lineage: readonly SlaWorkPeriodLineage[] }
    | { readonly state: 'not_ready'; readonly reason: 'MISSING_CALENDAR' | 'INVALID_CALENDAR'
        | 'MISSING_OWNER' | 'INVALID_OWNER' | 'INVALID_COVERAGE' | 'INCOMPLETE_COVERAGE'
        | 'INVALID_PERIOD' | 'DUPLICATE_PERIOD_ID' | 'CALENDAR_OWNER_MISMATCH'
        | 'WORK_OUTSIDE_COVERAGE' | 'OVERLAPPING_WORK' | 'TOO_MANY_PERIODS' };

type RecordValue = Record<string, unknown>;
interface Interval { readonly start: bigint; readonly end: bigint }
interface WorkInterval extends Interval { readonly id: string }
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value: RecordValue, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
    && !Array.from(value).some(character => character.length === 1 && /[\ud800-\udfff]/u.test(character));
const minimumInstant = parseEvidenceTimestamp('0001-01-01T00:00:00.000000Z')!;
const maximumInstant = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
const microsPerSecond = BigInt(1_000_000);
const zero = BigInt(0);
const maxPeriods = 10_000; // Same bound accepted by the downstream staff clock.
const notReady = (reason: Extract<PrepareSlaWorkCalendarResult, { state: 'not_ready' }>['reason']): PrepareSlaWorkCalendarResult => ({ state: 'not_ready', reason });

function instant(value: unknown): bigint | null {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return null;
    const parsed = parseEvidenceTimestamp(value);
    return parsed !== null && parsed >= minimumInstant && parsed <= maximumInstant ? parsed : null;
}

/** Only an integral second becomes Number; exact microseconds remain bigint. */
function utcTimestamp(value: bigint): string {
    let seconds = value / microsPerSecond;
    let remainder = value % microsPerSecond;
    if (remainder < zero) { seconds -= BigInt(1); remainder += microsPerSecond; }
    return `${new Date(Number(seconds * BigInt(1000))).toISOString().slice(0, 19)}.${remainder.toString().padStart(6, '0')}Z`;
}

const byStart = (a: Interval, b: Interval) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0;

/**
 * Work must be wholly inside coverage; clipping work would hide incomplete source
 * evidence. Approved exclusions may span coverage and are clipped to it before
 * union/subtraction. Overlapping WORK is ambiguous and fails closed; overlapping
 * exclusions are a union, never counted twice. All intervals are [start, end).
 *
 * Segment IDs are exact UTC bounds, unique inside this calendar id/version and
 * deterministic across input order or equivalent timestamp offsets. Keep that
 * calendar identity/version with IDs; they are not globally unique database IDs.
 * Output covers only actual supplied work and never claims a staff due date.
 */
export function prepareSlaWorkCalendar(raw: RawSlaWorkCalendar | null | undefined): PrepareSlaWorkCalendarResult {
    if (raw === null || raw === undefined) return notReady('MISSING_CALENDAR');
    if (!isRecord(raw) || !allowedKeys(raw, ['id', 'version', 'ownerUserId', 'coverage', 'periods'])
        || !identity(raw.id) || !identity(raw.version)) return notReady('INVALID_CALENDAR');
    if (raw.ownerUserId === null || raw.ownerUserId === undefined || raw.ownerUserId === '') return notReady('MISSING_OWNER');
    if (!identity(raw.ownerUserId)) return notReady('INVALID_OWNER');
    const coverage = raw.coverage;
    if (!isRecord(coverage) || !allowedKeys(coverage, ['startsAt', 'endsAt', 'complete'])
        || typeof coverage.complete !== 'boolean') return notReady('INVALID_COVERAGE');
    if (!coverage.complete) return notReady('INCOMPLETE_COVERAGE');
    const from = instant(coverage.startsAt), through = instant(coverage.endsAt);
    if (from === null || through === null || from >= through) return notReady('INVALID_COVERAGE');
    if (!Array.isArray(raw.periods)) return notReady('INVALID_CALENDAR');
    if (raw.periods.length > maxPeriods) return notReady('TOO_MANY_PERIODS');

    const seenIds = new Set<string>();
    const work: WorkInterval[] = [];
    const exclusions: Interval[] = [];
    for (const row of raw.periods as readonly unknown[]) {
        if (!isRecord(row) || !allowedKeys(row, ['id', 'salesUserId', 'type', 'startsAt', 'endsAt'])
            || !identity(row.id) || !identity(row.salesUserId)
            || !['work', 'leave', 'break'].includes(row.type as string)) return notReady('INVALID_PERIOD');
        if (seenIds.has(row.id)) return notReady('DUPLICATE_PERIOD_ID');
        if (row.salesUserId !== raw.ownerUserId) return notReady('CALENDAR_OWNER_MISMATCH');
        const start = instant(row.startsAt), end = instant(row.endsAt);
        if (start === null || end === null || start >= end) return notReady('INVALID_PERIOD');
        seenIds.add(row.id);
        if (row.type === 'work') {
            if (start < from || end > through) return notReady('WORK_OUTSIDE_COVERAGE');
            work.push({ id: row.id, start, end });
        } else if (start < through && end > from) {
            exclusions.push({ start: start < from ? from : start, end: end > through ? through : end });
        }
    }

    work.sort(byStart);
    for (let index = 1; index < work.length; index++) {
        if (work[index].start < work[index - 1].end) return notReady('OVERLAPPING_WORK');
    }
    exclusions.sort(byStart);
    const union: Interval[] = [];
    for (const exclusion of exclusions) {
        const last = union[union.length - 1];
        if (!last || exclusion.start > last.end) union.push(exclusion);
        else if (exclusion.end > last.end) union[union.length - 1] = { start: last.start, end: exclusion.end };
    }

    const workPeriods: SlaWorkPeriod[] = [];
    const lineage: SlaWorkPeriodLineage[] = [];
    function append(start: bigint, end: bigint, sourcePeriodId: string) {
        if (start >= end) return;
        const id = `sla:${start}:${end}`;
        workPeriods.push({ id, startsAt: utcTimestamp(start), endsAt: utcTimestamp(end) });
        lineage.push({ workPeriodId: id, sourcePeriodId });
    }
    let exclusionIndex = 0;
    for (const period of work) {
        while (exclusionIndex < union.length && union[exclusionIndex].end <= period.start) exclusionIndex++;
        let cursor = period.start;
        while (exclusionIndex < union.length && union[exclusionIndex].start < period.end) {
            const exclusion = union[exclusionIndex];
            if (exclusion.start > cursor) append(cursor, exclusion.start, period.id);
            if (exclusion.end > cursor) cursor = exclusion.end;
            if (cursor >= period.end) break;
            exclusionIndex++;
        }
        append(cursor, period.end, period.id);
        if (workPeriods.length > maxPeriods) return notReady('TOO_MANY_PERIODS');
    }

    return { state: 'ready', calendar: { id: raw.id, version: raw.version, ownerUserId: raw.ownerUserId,
        coverage: { startsAt: utcTimestamp(from), endsAt: utcTimestamp(through), complete: true },
        leaveAndBreaksSubtracted: true, workPeriods }, lineage };
}
