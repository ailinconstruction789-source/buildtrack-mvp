/** Pure first-contact staff-clock arithmetic under an explicitly approved policy.
 * The trusted caller supplies the ORIGINAL lead anchor, already stored elapsed
 * service deadline, unchanged ownership and complete prepared actual-work calendar.
 * This does not authenticate those claims or calculate/reset the service clock.
 * No current-time lookup, database call, task mutation, reminder or score occurs.
 */
import { parseEvidenceTimestamp } from './leadEvidence';
import { calculateOutOfHoursStaffDeadline, type OutOfHoursStaffInput, type SlaWorkCalendar } from './slaClock';

export interface InitialContactStaffPolicy {
    readonly approval: 'approved' | 'unapproved';
    readonly version: string;
    readonly workingMinutes: number;
}
export interface InitialContactStaffInput {
    readonly anchorAt: string | null;
    readonly serviceDueAt: string | null;
    readonly ownerUserId: string | null;
    readonly ownership: 'unchanged' | 'changed' | 'unknown';
    readonly calendar: SlaWorkCalendar | null;
    readonly policy: InitialContactStaffPolicy | null;
}
export type InitialContactStaffResult =
    | { readonly state: 'ready'; readonly rule: 'out_of_hours' | 'service_deadline' | 'off_shift_service_deadline';
        readonly anchorAt: string; readonly ownerUserId: string; readonly serviceDueAt: string;
        readonly staffDueAt: string; readonly notifyAt: string; readonly calendarId: string;
        readonly calendarVersion: string; readonly policyVersion: string; readonly usedWorkPeriodIds: readonly string[] }
    | { readonly state: 'not_ready' | 'needs_policy'; readonly reason: string };

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value: RecordValue, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const absent = (value: unknown) => value === null || value === undefined || value === '';
const minimumInstant = parseEvidenceTimestamp('0001-01-01T00:00:00.000000Z')!;
const maximumInstant = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
const notReady = (reason: string): InitialContactStaffResult => ({ state: 'not_ready', reason });
const needsPolicy = (reason: string): InitialContactStaffResult => ({ state: 'needs_policy', reason });
function instant(value: unknown): bigint | null {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return null;
    return parseEvidenceTimestamp(value);
}

/** Intervals are [start,end). An in-hours lead keeps its stored service deadline
 * as the staff deadline if that instant is actual work. Otherwise only the staff
 * deadline advances by the approved number of ACTUAL working minutes starting at
 * the next period after serviceDueAt. An out-of-hours lead uses the existing
 * next-actual-period rule from its original anchor instead.
 *
 * usedWorkPeriodIds identifies the containing due period for the direct rule, or
 * exactly the accumulated work periods for a next-period rule. The calendar ID
 * and version retain the complete evidence used to classify the original anchor.
 * Reassignment stays held: this function never invents a transfer-of-owner rule.
 */
export function calculateInitialContactStaffDeadline(input: InitialContactStaffInput): InitialContactStaffResult {
    if (!isRecord(input) || !allowedKeys(input, ['anchorAt', 'serviceDueAt', 'ownerUserId', 'ownership', 'calendar', 'policy'])) return notReady('INVALID_INPUT');
    if (input.ownership === 'changed') return needsPolicy('OWNER_CHANGED');
    if (absent(input.ownership) || input.ownership === 'unknown') return needsPolicy('OWNER_HISTORY_UNKNOWN');
    if (input.ownership !== 'unchanged') return notReady('INVALID_INPUT');
    const policy: unknown = input.policy;
    if (absent(policy)) return needsPolicy('INITIAL_CONTACT_RULE_UNAPPROVED');
    if (!isRecord(policy) || !allowedKeys(policy, ['approval', 'version', 'workingMinutes'])) return needsPolicy('INVALID_STAFF_POLICY');

    if (absent(input.anchorAt)) return notReady('MISSING_ANCHOR');
    const anchor = instant(input.anchorAt);
    if (anchor === null) return notReady('INVALID_ANCHOR');
    if (anchor < minimumInstant || anchor > maximumInstant) return notReady('DATE_OUT_OF_RANGE');
    if (absent(input.serviceDueAt)) return notReady('MISSING_SERVICE_DEADLINE');
    const serviceDue = instant(input.serviceDueAt);
    if (serviceDue === null) return notReady('INVALID_SERVICE_DEADLINE');
    if (serviceDue < minimumInstant || serviceDue > maximumInstant) return notReady('DATE_OUT_OF_RANGE');
    if (serviceDue < anchor) return notReady('SERVICE_DEADLINE_BEFORE_ANCHOR');

    // Delegate validation of owner, policy identity/duration, complete prepared
    // coverage, exclusions, bounded unique intervals and overlaps to the existing
    // exact-microsecond clock. Its in-hours result is emitted only AFTER all these
    // checks; only that precise result is safe to use for our new in-hours branch.
    const common: OutOfHoursStaffInput = { anchorAt: input.anchorAt, ownerUserId: input.ownerUserId,
        ownership: input.ownership, calendar: input.calendar,
        policy: { rule: 'next_actual_work_period', ...input.policy! } };
    const initial = calculateOutOfHoursStaffDeadline(common);
    if (initial.state === 'ready') {
        return { state: 'ready', rule: 'out_of_hours', anchorAt: initial.anchorAt, ownerUserId: initial.ownerUserId,
            serviceDueAt: input.serviceDueAt!, staffDueAt: initial.staffDueAt, notifyAt: initial.workStartsAt,
            calendarId: initial.calendarId, calendarVersion: initial.calendarVersion, policyVersion: initial.policyVersion,
            usedWorkPeriodIds: initial.usedWorkPeriodIds };
    }
    if (initial.state !== 'needs_policy' || initial.reason !== 'ANCHOR_IN_WORKING_HOURS') {
        return initial.reason === 'OUT_OF_HOURS_RULE_UNAPPROVED' ? needsPolicy('INITIAL_CONTACT_RULE_UNAPPROVED') : initial;
    }

    const calendar = input.calendar!;
    const from = instant(calendar.coverage.startsAt)!, through = instant(calendar.coverage.endsAt)!;
    if (serviceDue < from || serviceDue >= through) return notReady('SERVICE_DUE_OUTSIDE_COVERAGE');
    const containingDuePeriod = calendar.workPeriods.find(period => instant(period.startsAt)! <= serviceDue && serviceDue < instant(period.endsAt)!);
    if (containingDuePeriod) {
        return { state: 'ready', rule: 'service_deadline', anchorAt: input.anchorAt!, ownerUserId: input.ownerUserId!,
            serviceDueAt: input.serviceDueAt!, staffDueAt: input.serviceDueAt!, notifyAt: input.anchorAt!,
            calendarId: calendar.id, calendarVersion: calendar.version, policyVersion: input.policy!.version,
            usedWorkPeriodIds: [containingDuePeriod.id] };
    }

    const deferred = calculateOutOfHoursStaffDeadline({ ...common, anchorAt: input.serviceDueAt });
    if (deferred.state !== 'ready') return deferred;
    return { state: 'ready', rule: 'off_shift_service_deadline', anchorAt: input.anchorAt!, ownerUserId: deferred.ownerUserId,
        serviceDueAt: input.serviceDueAt!, staffDueAt: deferred.staffDueAt, notifyAt: input.anchorAt!,
        calendarId: deferred.calendarId, calendarVersion: deferred.calendarVersion, policyVersion: deferred.policyVersion,
        usedWorkPeriodIds: deferred.usedWorkPeriodIds };
}
