/**
 * PURE, UNCONNECTED SLA arithmetic, not a scheduler or an employee scorer.
 * A trusted projection must establish original source times, qualifying-activity
 * classification, owner history, policy approval and calendar completeness. Passing
 * browser claims through these functions does not authenticate that evidence.
 *
 * Service time and staff time deliberately have separate inputs and results. No
 * reassignment, customer postponement or staff calendar can rewrite service time.
 * No task creation/closure, notification, KPI credit, or current-clock lookup here.
 */
import { parseEvidenceTimestamp } from './leadEvidence';

export interface ServiceSlaPolicy {
    readonly version: string;
    readonly firstContactHours: number;
    readonly followUpHours: number;
    readonly hotPostVisitHours: number;
}

export const DEFAULT_SERVICE_SLA_POLICY: ServiceSlaPolicy = Object.freeze({
    version: 'service_sla_v1', firstContactHours: 24, followUpHours: 48, hotPostVisitHours: 24,
});
export const DEFAULT_OUT_OF_HOURS_WORKING_MINUTES = 120;

export type ServiceDeadlineInput =
    | { readonly kind: 'first_contact'; readonly leadId: string | null; readonly originalLeadAt: string | null }
    | { readonly kind: 'follow_up'; readonly qualifyingActivity: { readonly id: string | null; readonly occurredAt: string | null } | null }
    | { readonly kind: 'hot_post_visit'; readonly actualVisit: { readonly id: string | null; readonly departedAt: string | null } | null };

export type ServiceDeadlineResult =
    | { readonly state: 'ready'; readonly kind: ServiceDeadlineInput['kind']; readonly sourceId: string;
        readonly anchorAt: string; readonly serviceDueAt: string; readonly durationHours: number; readonly policyVersion: string }
    | { readonly state: 'needs_evidence'; readonly reason: 'MISSING_SOURCE' | 'MISSING_SOURCE_ID' | 'MISSING_ANCHOR' }
    | { readonly state: 'invalid'; readonly reason: 'INVALID_INPUT' | 'INVALID_POLICY' | 'INVALID_SOURCE_ID' | 'INVALID_ANCHOR' | 'DATE_OUT_OF_RANGE' };

export interface SlaWorkPeriod {
    readonly id: string;
    readonly startsAt: string;
    readonly endsAt: string;
}

/** Complete coverage is a positive assertion that ALL working intervals and all
 * leave/break exclusions in [startsAt, endsAt) have been supplied for this owner.
 * Absence of a period only means non-working time inside such proven coverage.
 */
export interface SlaWorkCalendar {
    readonly id: string;
    readonly version: string;
    readonly ownerUserId: string;
    readonly leaveAndBreaksSubtracted: boolean;
    readonly coverage: { readonly startsAt: string; readonly endsAt: string; readonly complete: boolean };
    readonly workPeriods: readonly SlaWorkPeriod[];
}

export interface OutOfHoursStaffPolicy {
    readonly rule: 'next_actual_work_period';
    readonly approval: 'approved' | 'unapproved';
    readonly version: string;
    readonly workingMinutes: number;
}

export interface OutOfHoursStaffInput {
    readonly anchorAt: string | null;
    readonly ownerUserId: string | null;
    /** Upstream must prove unchanged ownership; no reassignment fairness rule is invented. */
    readonly ownership: 'unchanged' | 'changed' | 'unknown';
    readonly policy: OutOfHoursStaffPolicy | null;
    readonly calendar: SlaWorkCalendar | null;
}

export type OutOfHoursStaffResult =
    | { readonly state: 'ready'; readonly anchorAt: string; readonly ownerUserId: string;
        readonly workStartsAt: string; readonly staffDueAt: string; readonly workingMinutes: number;
        readonly policyVersion: string; readonly calendarId: string; readonly calendarVersion: string;
        readonly usedWorkPeriodIds: readonly string[] }
    | { readonly state: 'needs_policy'; readonly reason: 'OWNER_HISTORY_UNKNOWN' | 'OWNER_CHANGED'
        | 'OUT_OF_HOURS_RULE_UNAPPROVED' | 'INVALID_STAFF_POLICY' | 'ANCHOR_IN_WORKING_HOURS' }
    | { readonly state: 'not_ready'; readonly reason: 'INVALID_INPUT' | 'MISSING_ANCHOR' | 'INVALID_ANCHOR'
        | 'MISSING_OWNER' | 'INVALID_OWNER' | 'MISSING_CALENDAR' | 'INVALID_CALENDAR'
        | 'INCOMPLETE_COVERAGE' | 'EXCLUSIONS_NOT_APPLIED' | 'CALENDAR_OWNER_MISMATCH'
        | 'ANCHOR_OUTSIDE_COVERAGE' | 'INSUFFICIENT_WORKING_TIME' | 'DATE_OUT_OF_RANGE' };

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value: RecordValue, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const absent = (value: unknown) => value === null || value === undefined || value === '';
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
    && !Array.from(value).some(character => character.length === 1 && /[\ud800-\udfff]/u.test(character));
const duration = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const microsPerMinute = BigInt(60_000_000);
const microsPerHour = BigInt(3_600_000_000);
const microsPerSecond = BigInt(1_000_000);
const zero = BigInt(0);
const minimumInstant = parseEvidenceTimestamp('0001-01-01T00:00:00.000000Z')!;
const maximumInstant = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;

function instant(value: unknown): bigint | null {
    // Restrict characters separately: do not rely on permissive parser/anchor rules.
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return null;
    return parseEvidenceTimestamp(value);
}

/** Date is only used for the integral UTC second, whose milliseconds are exact in
 * the supported four-digit-year range. Fractional microseconds never become Number. */
function utcTimestamp(value: bigint): string | null {
    if (value < minimumInstant || value > maximumInstant) return null;
    let seconds = value / microsPerSecond;
    let remainder = value % microsPerSecond;
    if (remainder < zero) { seconds -= BigInt(1); remainder += microsPerSecond; }
    const wholeSecond = new Date(Number(seconds * BigInt(1000))).toISOString().slice(0, 19);
    return `${wholeSecond}.${remainder.toString().padStart(6, '0')}Z`;
}

function validServicePolicy(value: unknown): value is ServiceSlaPolicy {
    return isRecord(value) && allowedKeys(value, ['version', 'firstContactHours', 'followUpHours', 'hotPostVisitHours'])
        && identity(value.version) && duration(value.firstContactHours) && duration(value.followUpHours) && duration(value.hotPostVisitHours);
}

/** qualifyingActivity means an ALREADY qualified, canonical latest source selected
 * by a trusted workflow. This function never decides whether no_answer, a note, or
 * any other activity qualifies, and never selects a newer source from a history. */
export function calculateServiceDeadline(input: ServiceDeadlineInput, policy: ServiceSlaPolicy = DEFAULT_SERVICE_SLA_POLICY): ServiceDeadlineResult {
    if (!validServicePolicy(policy)) return { state: 'invalid', reason: 'INVALID_POLICY' };
    if (!isRecord(input)) return { state: 'invalid', reason: 'INVALID_INPUT' };
    let sourceId: unknown, anchorAt: unknown, hours: number;
    const invalidInput = (): ServiceDeadlineResult => ({ state: 'invalid', reason: 'INVALID_INPUT' });
    switch (input.kind) {
        case 'first_contact':
            if (!allowedKeys(input, ['kind', 'leadId', 'originalLeadAt'])) return invalidInput();
            sourceId = input.leadId; anchorAt = input.originalLeadAt; hours = policy.firstContactHours;
            break;
        case 'follow_up': {
            if (!allowedKeys(input, ['kind', 'qualifyingActivity'])) return invalidInput();
            const source: unknown = input.qualifyingActivity;
            if (absent(source)) return { state: 'needs_evidence', reason: 'MISSING_SOURCE' };
            if (!isRecord(source) || !allowedKeys(source, ['id', 'occurredAt'])) return invalidInput();
            sourceId = source.id; anchorAt = source.occurredAt; hours = policy.followUpHours;
            break;
        }
        case 'hot_post_visit': {
            if (!allowedKeys(input, ['kind', 'actualVisit'])) return invalidInput();
            const source: unknown = input.actualVisit;
            if (absent(source)) return { state: 'needs_evidence', reason: 'MISSING_SOURCE' };
            if (!isRecord(source) || !allowedKeys(source, ['id', 'departedAt'])) return invalidInput();
            sourceId = source.id; anchorAt = source.departedAt; hours = policy.hotPostVisitHours;
            break;
        }
        default: return invalidInput();
    }
    if (absent(sourceId)) return { state: 'needs_evidence', reason: 'MISSING_SOURCE_ID' };
    if (!identity(sourceId)) return { state: 'invalid', reason: 'INVALID_SOURCE_ID' };
    if (absent(anchorAt)) return { state: 'needs_evidence', reason: 'MISSING_ANCHOR' };
    const start = instant(anchorAt);
    if (start === null) return { state: 'invalid', reason: 'INVALID_ANCHOR' };
    if (start < minimumInstant || start > maximumInstant) return { state: 'invalid', reason: 'DATE_OUT_OF_RANGE' };
    const due = utcTimestamp(start + BigInt(hours) * microsPerHour);
    if (due === null) return { state: 'invalid', reason: 'DATE_OUT_OF_RANGE' };
    return { state: 'ready', kind: input.kind, sourceId, anchorAt: anchorAt as string,
        serviceDueAt: due, durationHours: hours, policyVersion: policy.version };
}

interface ParsedPeriod { readonly id: string; readonly start: bigint; readonly end: bigint }
const notReady = (reason: Extract<OutOfHoursStaffResult, { state: 'not_ready' }>['reason']): OutOfHoursStaffResult => ({ state: 'not_ready', reason });
const needsPolicy = (reason: Extract<OutOfHoursStaffResult, { state: 'needs_policy' }>['reason']): OutOfHoursStaffResult => ({ state: 'needs_policy', reason });

/** The ONLY supported staff rule is the explicitly approved out-of-hours case.
 * Intervals are half-open [start,end); two approved working hours may cross any
 * supplied break/leave/non-working gap. In-hours and reassignment rules are pending.
 * A not_ready/needs_policy result contains no staff deadline or blame/score field. */
export function calculateOutOfHoursStaffDeadline(input: OutOfHoursStaffInput): OutOfHoursStaffResult {
    if (!isRecord(input) || !allowedKeys(input, ['anchorAt', 'ownerUserId', 'ownership', 'policy', 'calendar'])) return notReady('INVALID_INPUT');
    if (input.ownership === 'changed') return needsPolicy('OWNER_CHANGED');
    if (absent(input.ownership) || input.ownership === 'unknown') return needsPolicy('OWNER_HISTORY_UNKNOWN');
    if (input.ownership !== 'unchanged') return notReady('INVALID_INPUT');
    const policy: unknown = input.policy;
    if (absent(policy)) return needsPolicy('OUT_OF_HOURS_RULE_UNAPPROVED');
    if (!isRecord(policy) || !allowedKeys(policy, ['rule', 'approval', 'version', 'workingMinutes'])
        || policy.rule !== 'next_actual_work_period' || !identity(policy.version) || !duration(policy.workingMinutes)) return needsPolicy('INVALID_STAFF_POLICY');
    if (policy.approval === 'unapproved') return needsPolicy('OUT_OF_HOURS_RULE_UNAPPROVED');
    if (policy.approval !== 'approved') return needsPolicy('INVALID_STAFF_POLICY');
    if (absent(input.anchorAt)) return notReady('MISSING_ANCHOR');
    const anchor = instant(input.anchorAt);
    if (anchor === null) return notReady('INVALID_ANCHOR');
    if (anchor < minimumInstant || anchor > maximumInstant) return notReady('DATE_OUT_OF_RANGE');
    if (absent(input.ownerUserId)) return notReady('MISSING_OWNER');
    if (!identity(input.ownerUserId)) return notReady('INVALID_OWNER');

    const calendar: unknown = input.calendar;
    if (absent(calendar)) return notReady('MISSING_CALENDAR');
    if (!isRecord(calendar) || !allowedKeys(calendar, ['id', 'version', 'ownerUserId', 'leaveAndBreaksSubtracted', 'coverage', 'workPeriods'])
        || !identity(calendar.id) || !identity(calendar.version) || !identity(calendar.ownerUserId)) return notReady('INVALID_CALENDAR');
    if (calendar.ownerUserId !== input.ownerUserId) return notReady('CALENDAR_OWNER_MISMATCH');
    if (calendar.leaveAndBreaksSubtracted !== true) return notReady('EXCLUSIONS_NOT_APPLIED');
    const coverage = calendar.coverage;
    if (!isRecord(coverage) || !allowedKeys(coverage, ['startsAt', 'endsAt', 'complete'])) return notReady('INVALID_CALENDAR');
    if (coverage.complete !== true) return notReady('INCOMPLETE_COVERAGE');
    const from = instant(coverage.startsAt), through = instant(coverage.endsAt);
    if (from === null || through === null || from >= through || from < minimumInstant || through > maximumInstant) return notReady('INVALID_CALENDAR');
    if (anchor < from || anchor >= through) return notReady('ANCHOR_OUTSIDE_COVERAGE');
    if (!Array.isArray(calendar.workPeriods) || calendar.workPeriods.length > 10_000) return notReady('INVALID_CALENDAR');

    const periods: ParsedPeriod[] = [];
    const seenIds = new Set<string>();
    for (const row of calendar.workPeriods as readonly unknown[]) {
        if (!isRecord(row) || !allowedKeys(row, ['id', 'startsAt', 'endsAt']) || !identity(row.id) || seenIds.has(row.id)) return notReady('INVALID_CALENDAR');
        const start = instant(row.startsAt), end = instant(row.endsAt);
        if (start === null || end === null || start >= end || start < from || end > through) return notReady('INVALID_CALENDAR');
        seenIds.add(row.id); periods.push({ id: row.id, start, end });
    }
    // Sort a private copy. Overlaps (including duplicate ranges) must be corrected,
    // not silently double-counted or merged into evidence the source did not provide.
    periods.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    for (let index = 1; index < periods.length; index++) {
        if (periods[index].start < periods[index - 1].end) return notReady('INVALID_CALENDAR');
    }
    if (periods.some(period => period.start <= anchor && anchor < period.end)) return needsPolicy('ANCHOR_IN_WORKING_HOURS');

    let remaining = BigInt(policy.workingMinutes) * microsPerMinute;
    let workStartsAt: string | null = null;
    const usedWorkPeriodIds: string[] = [];
    for (const period of periods) {
        if (period.start <= anchor) continue;
        if (workStartsAt === null) workStartsAt = utcTimestamp(period.start);
        usedWorkPeriodIds.push(period.id);
        const available = period.end - period.start;
        if (remaining <= available) {
            const due = utcTimestamp(period.start + remaining);
            if (due === null || workStartsAt === null) return notReady('DATE_OUT_OF_RANGE');
            return { state: 'ready', anchorAt: input.anchorAt as string, ownerUserId: input.ownerUserId,
                workStartsAt, staffDueAt: due, workingMinutes: policy.workingMinutes, policyVersion: policy.version,
                calendarId: calendar.id, calendarVersion: calendar.version, usedWorkPeriodIds };
        }
        remaining -= available;
    }
    return notReady('INSUFFICIENT_WORKING_TIME');
}
