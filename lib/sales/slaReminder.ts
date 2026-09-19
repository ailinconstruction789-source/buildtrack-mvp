/**
 * PURE candidate planner, NOT a notifier, scheduler, authorization check or score.
 * A trusted CURRENT projection must bind task, owner, lifecycle revision and the
 * approved accountability calculation to its complete prepared calendar snapshot.
 * Browser claims cannot establish those facts. No default notice policy is used.
 *
 * Before persistence/delivery, a future transactional worker MUST recheck current
 * owner/status/revision/calendar, honor lifecycle SQL 05 withdrawal, and enforce
 * (recipient_user_id, dedupe_key) uniqueness. Never restore a withdrawn notice or
 * move another owner's read receipt. This module neither reads nor writes notices.
 */
import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { prepareSlaWorkCalendar, type RawSlaWorkPeriod } from './slaCalendar';
import type { SlaWorkCalendar } from './slaClock';

export interface SlaReminderAccountability {
    readonly state: 'ready' | 'needs_schedule' | 'needs_owner' | 'exception';
    readonly ownerUserId: string | null;
    readonly lifecycleRevision: string | null;
    readonly calendarId: string | null;
    readonly calendarVersion: string | null;
    readonly staffDueAt: string | null;
    readonly notifyAt: string | null;
    readonly lifecycleReview: 'clear' | 'owner_change_pending_review';
}

export interface SlaReminderTask {
    readonly id: string;
    readonly ownerUserId: string | null;
    readonly ownerActive: boolean;
    readonly lifecycleRevision: string;
    readonly status: 'open' | 'done' | 'cancelled';
    readonly scopeClosed: boolean;
    readonly serviceDueAt: string;
    readonly accountability: SlaReminderAccountability | null;
}

export interface SlaReminderPolicy {
    readonly version: string;
    /** Explicit approved lead time in whole minutes; zero means at-due only. */
    readonly dueSoonMinutes: number;
}

export interface InAppSlaReminderInput {
    readonly task: SlaReminderTask | null;
    readonly asOf: string;
    readonly calendar: SlaWorkCalendar | null;
    readonly policy: SlaReminderPolicy | null;
}

export interface InAppSlaReminderCandidate {
    readonly channel: 'in_app';
    readonly taskId: string;
    readonly recipientUserId: string;
    readonly lifecycleRevision: string;
    readonly notificationType: 'due_soon' | 'overdue';
    readonly dedupeKey: string;
    readonly availableAt: string;
    readonly staffDueAt: string;
    /** Customer wait context only; never used to classify the staff reminder. */
    readonly serviceDueAt: string;
    readonly calendarId: string;
    readonly calendarVersion: string;
    readonly policyVersion: string;
}

export type InAppSlaReminderResult =
    | { readonly state: 'ready'; readonly candidate: InAppSlaReminderCandidate }
    | { readonly state: 'none'; readonly reason: 'TASK_CLOSED' | 'OUTSIDE_WORKING_HOURS' | 'NOT_YET_AVAILABLE' | 'NOT_DUE_SOON' }
    | { readonly state: 'not_ready'; readonly reason: 'INVALID_INPUT' | 'MISSING_TASK' | 'INVALID_TASK'
        | 'MISSING_POLICY' | 'INVALID_POLICY' | 'INVALID_AS_OF' | 'MISSING_OWNER' | 'INACTIVE_OWNER'
        | 'ACCOUNTABILITY_NOT_READY' | 'OWNER_CHANGE_PENDING_REVIEW' | 'INVALID_ACCOUNTABILITY' | 'STALE_ACCOUNTABILITY'
        | 'MISSING_CALENDAR' | 'INVALID_CALENDAR' | 'CALENDAR_OWNER_MISMATCH' | 'AS_OF_OUTSIDE_COVERAGE' };

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value: RecordValue, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
    && !Array.from(value).some(character => character.length === 1 && /[\ud800-\udfff]/u.test(character));
const uuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const minimumInstant = parseEvidenceTimestamp('0001-01-01T00:00:00.000000Z')!;
const maximumInstant = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
const microsPerSecond = BigInt(1_000_000);
const microsPerMinute = BigInt(60_000_000);
const zero = BigInt(0);
const notReady = (reason: Extract<InAppSlaReminderResult, { state: 'not_ready' }>['reason']): InAppSlaReminderResult => ({ state: 'not_ready', reason });
const none = (reason: Extract<InAppSlaReminderResult, { state: 'none' }>['reason']): InAppSlaReminderResult => ({ state: 'none', reason });

function instant(value: unknown): bigint | null {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return null;
    const parsed = parseEvidenceTimestamp(value);
    return parsed !== null && parsed >= minimumInstant && parsed <= maximumInstant ? parsed : null;
}
function utcTimestamp(value: bigint): string {
    let seconds = value / microsPerSecond;
    let remainder = value % microsPerSecond;
    if (remainder < zero) { seconds -= BigInt(1); remainder += microsPerSecond; }
    return `${new Date(Number(seconds * BigInt(1000))).toISOString().slice(0, 19)}.${remainder.toString().padStart(6, '0')}Z`;
}

/** Validate the prepared-only shape, then reuse the interval validator. This does
 * not prove exclusions were really subtracted; that remains a trusted projection
 * prerequisite, exactly as in slaClock. Never reinterpret raw leave as work. */
function checkedCalendar(value: unknown): SlaWorkCalendar | null {
    if (!isRecord(value) || !allowedKeys(value, ['id', 'version', 'ownerUserId', 'coverage', 'leaveAndBreaksSubtracted', 'workPeriods'])
        || value.leaveAndBreaksSubtracted !== true || !Array.isArray(value.workPeriods) || value.workPeriods.length > 10_000) return null;
    const periods: RawSlaWorkPeriod[] = [];
    for (const period of value.workPeriods as readonly unknown[]) {
        if (!isRecord(period) || !allowedKeys(period, ['id', 'startsAt', 'endsAt'])
            || !identity(period.id) || typeof period.startsAt !== 'string' || typeof period.endsAt !== 'string') return null;
        periods.push({ id: period.id, type: 'work', salesUserId: value.ownerUserId as string, startsAt: period.startsAt, endsAt: period.endsAt });
    }
    const result = prepareSlaWorkCalendar({ id: value.id as string, version: value.version as string,
        ownerUserId: value.ownerUserId as string, coverage: value.coverage as SlaWorkCalendar['coverage'], periods });
    return result.state === 'ready' ? result.calendar : null;
}

export function planInAppSlaReminder(input: InAppSlaReminderInput): InAppSlaReminderResult {
    if (!isRecord(input) || !allowedKeys(input, ['task', 'asOf', 'calendar', 'policy'])) return notReady('INVALID_INPUT');
    const asOf = instant(input.asOf);
    if (asOf === null) return notReady('INVALID_AS_OF');
    const task: unknown = input.task;
    if (task === null || task === undefined) return notReady('MISSING_TASK');
    if (!isRecord(task) || !allowedKeys(task, ['id', 'ownerUserId', 'ownerActive', 'lifecycleRevision', 'status', 'scopeClosed', 'serviceDueAt', 'accountability'])
        || !uuid(task.id) || !uuid(task.lifecycleRevision) || typeof task.ownerActive !== 'boolean' || typeof task.scopeClosed !== 'boolean'
        || !['open', 'done', 'cancelled'].includes(task.status as string)) return notReady('INVALID_TASK');
    if (task.status !== 'open' || task.scopeClosed) return none('TASK_CLOSED');
    if (task.ownerUserId === null || task.ownerUserId === undefined || task.ownerUserId === '') return notReady('MISSING_OWNER');
    if (!uuid(task.ownerUserId)) return notReady('INVALID_TASK');
    if (!task.ownerActive) return notReady('INACTIVE_OWNER');
    const serviceDue = instant(task.serviceDueAt);
    if (serviceDue === null) return notReady('INVALID_TASK');

    const accountability = task.accountability;
    if (accountability === null || accountability === undefined) return notReady('ACCOUNTABILITY_NOT_READY');
    if (!isRecord(accountability) || !allowedKeys(accountability, ['state', 'ownerUserId', 'lifecycleRevision', 'calendarId', 'calendarVersion', 'staffDueAt', 'notifyAt', 'lifecycleReview'])
        || !['ready', 'needs_schedule', 'needs_owner', 'exception'].includes(accountability.state as string)
        || !['clear', 'owner_change_pending_review'].includes(accountability.lifecycleReview as string)) return notReady('INVALID_ACCOUNTABILITY');
    if (accountability.lifecycleReview === 'owner_change_pending_review') return notReady('OWNER_CHANGE_PENDING_REVIEW');
    if (accountability.state !== 'ready') return notReady('ACCOUNTABILITY_NOT_READY');
    if (!uuid(accountability.ownerUserId) || !uuid(accountability.lifecycleRevision)
        || !identity(accountability.calendarId) || !identity(accountability.calendarVersion)) return notReady('INVALID_ACCOUNTABILITY');
    if (accountability.ownerUserId.toLowerCase() !== task.ownerUserId.toLowerCase()
        || accountability.lifecycleRevision.toLowerCase() !== task.lifecycleRevision.toLowerCase()) return notReady('STALE_ACCOUNTABILITY');
    const staffDue = instant(accountability.staffDueAt), notifyAt = instant(accountability.notifyAt);
    if (staffDue === null || notifyAt === null || notifyAt > staffDue) return notReady('INVALID_ACCOUNTABILITY');

    const policy: unknown = input.policy;
    if (policy === null || policy === undefined) return notReady('MISSING_POLICY');
    if (!isRecord(policy) || !allowedKeys(policy, ['version', 'dueSoonMinutes']) || !identity(policy.version)
        || typeof policy.dueSoonMinutes !== 'number' || !Number.isSafeInteger(policy.dueSoonMinutes) || policy.dueSoonMinutes < 0) return notReady('INVALID_POLICY');
    if (input.calendar === null || input.calendar === undefined) return notReady('MISSING_CALENDAR');
    const calendar = checkedCalendar(input.calendar);
    if (!calendar) return notReady('INVALID_CALENDAR');
    if (!uuid(calendar.ownerUserId) || calendar.ownerUserId.toLowerCase() !== task.ownerUserId.toLowerCase()) return notReady('CALENDAR_OWNER_MISMATCH');
    if (calendar.id !== accountability.calendarId || calendar.version !== accountability.calendarVersion) return notReady('STALE_ACCOUNTABILITY');
    const from = instant(calendar.coverage.startsAt)!, through = instant(calendar.coverage.endsAt)!;
    // The prepared snapshot must cover the calculation, not merely today's shift.
    if (notifyAt < from || notifyAt >= through || staffDue < from || staffDue > through) return notReady('INVALID_ACCOUNTABILITY');
    if (asOf < from || asOf >= through) return notReady('AS_OF_OUTSIDE_COVERAGE');
    const periods = calendar.workPeriods.map(period => ({ start: instant(period.startsAt)!, end: instant(period.endsAt)! }));
    if (!periods.some(period => period.start <= asOf && asOf < period.end)) return none('OUTSIDE_WORKING_HOURS');
    if (asOf < notifyAt) return none('NOT_YET_AVAILABLE');

    const overdue = asOf > staffDue;
    const threshold = overdue ? staffDue + BigInt(1) : staffDue - BigInt(policy.dueSoonMinutes) * microsPerMinute;
    if (asOf < threshold) return none('NOT_DUE_SOON');
    const eligibleFrom = notifyAt > threshold ? notifyAt : threshold;
    const firstEligiblePeriod = periods.find(period => period.end > eligibleFrom && period.start <= asOf)!;
    const availableAt = firstEligiblePeriod.start > eligibleFrom ? firstEligiblePeriod.start : eligibleFrom;
    const taskId = task.id.toLowerCase(), recipientUserId = task.ownerUserId.toLowerCase(), lifecycleRevision = task.lifecycleRevision.toLowerCase();
    const notificationType = overdue ? 'overdue' : 'due_soon';
    const staffDueAt = utcTimestamp(staffDue);
    // JSON tuples are unambiguous even when an approved policy version has ':',
    // quotes or non-ASCII characters. No poll time or private human text is used.
    const dedupeKey = `sla_reminder_v1:${JSON.stringify([taskId, recipientUserId, lifecycleRevision, notificationType, staffDueAt, policy.version, policy.dueSoonMinutes])}`;
    return { state: 'ready', candidate: { channel: 'in_app', taskId, recipientUserId, lifecycleRevision,
        notificationType, dedupeKey, availableAt: utcTimestamp(availableAt), staffDueAt,
        serviceDueAt: utcTimestamp(serviceDue), calendarId: calendar.id, calendarVersion: calendar.version, policyVersion: policy.version } };
}
