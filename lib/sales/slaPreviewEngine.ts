/** Read-only composition of trusted source evidence and the pure clocks.
 * A ready result is a PREVIEW, never a persisted ready proof, a notification
 * delivery command, task completion, or permission to write a browser claim.
 */
import { parseEvidenceTimestamp } from './leadEvidence';
import { prepareSlaWorkCalendar } from './slaCalendar';
import { calculateServiceDeadline } from './slaClock';
import { calculateInitialContactStaffDeadline } from './initialContactStaffClock';
import { planInAppSlaReminder } from './slaReminder';
import type { SlaPreviewReason, SlaPreviewRow, SlaPreviewSnapshot, SlaPreviewSource, SlaPreviewSourceTask } from './slaPreviewTypes';

export const SLA_PREVIEW_POLICY_VERSION = 'first_contact_preview_2026_09_17' as const;
export const SLA_PREVIEW_DUE_SOON_MINUTES = 30 as const;

function evaluate(task: SlaPreviewSourceTask, source: SlaPreviewSource): SlaPreviewRow {
    const base = { taskId: task.id, customerId: task.customerId, customerName: task.customerName,
        ownerUserId: task.ownerUserId, ownerName: task.ownerName, serviceDueAt: task.serviceDueAt };
    const held = (reason: SlaPreviewReason): SlaPreviewRow => ({ ...base, state: 'held', reason,
        staffDueAt: null, notifyAt: null, rule: null, calendarVersion: null, notificationType: null });
    if (task.scopeClosed) return held('SCOPE_CLOSED');
    if (task.recordOrigin !== 'live') return held('LEGACY_REVIEW');
    if (!task.ownerUserId || task.ownerUserId !== task.scopeOwnerUserId || !task.ownerIsActiveSales) return held('OWNER_NOT_READY');
    if (task.lifecycleReviewPending) return held('OWNER_REVIEW');
    if (!task.creationProven) return held('MISSING_CREATION_EVIDENCE');
    if (!task.ownerHistoryUnchanged) return held('OWNER_REVIEW');
    // Evidence may establish that an open task is stale. This read path does not
    // pick the qualifying activity or close it; do not send against it meanwhile.
    if (task.hasContactEvidence) return held('CONTACT_REVIEW');
    if (task.hasCustomerPostponement) return held('CUSTOMER_POSTPONEMENT');
    if (task.hasExceptions) return held('EXCEPTION_REVIEW');
    if (source.settings.initialContactHours !== 24 || source.settings.nextShiftResponseMinutes !== 120
        || task.initialContactHours !== 24) return held('POLICY_REVIEW');
    const anchor = parseEvidenceTimestamp(task.leadCreatedAt), obligation = parseEvidenceTimestamp(task.obligationStartedAt);
    const created = parseEvidenceTimestamp(task.taskCreatedAt), asOf = parseEvidenceTimestamp(source.asOf);
    if (anchor === null || obligation === null || created === null || asOf === null
        || anchor !== obligation || anchor > asOf || created < anchor || created > asOf) return held('SOURCE_TIME_REVIEW');
    const service = calculateServiceDeadline({ kind: 'first_contact', leadId: task.customerId, originalLeadAt: task.leadCreatedAt },
        { version: SLA_PREVIEW_POLICY_VERSION, firstContactHours: 24, followUpHours: 48, hotPostVisitHours: 24 });
    if (service.state !== 'ready' || parseEvidenceTimestamp(service.serviceDueAt) !== parseEvidenceTimestamp(task.serviceDueAt)) return held('SOURCE_TIME_REVIEW');
    if (!task.calendar) return held('MISSING_CALENDAR');
    const prepared = prepareSlaWorkCalendar(task.calendar);
    if (prepared.state !== 'ready') return held(prepared.reason === 'INCOMPLETE_COVERAGE' ? 'INSUFFICIENT_COVERAGE' : 'INVALID_CALENDAR');
    if (prepared.calendar.ownerUserId !== task.ownerUserId) return held('INVALID_CALENDAR');
    const staff = calculateInitialContactStaffDeadline({ anchorAt: task.leadCreatedAt, serviceDueAt: task.serviceDueAt,
        ownerUserId: task.ownerUserId, ownership: 'unchanged', calendar: prepared.calendar,
        policy: { version: SLA_PREVIEW_POLICY_VERSION, approval: 'approved', workingMinutes: 120 } });
    if (staff.state !== 'ready') {
        return held(['ANCHOR_OUTSIDE_COVERAGE', 'SERVICE_DUE_OUTSIDE_COVERAGE', 'INSUFFICIENT_WORKING_TIME', 'INCOMPLETE_COVERAGE'].includes(staff.reason)
            ? 'INSUFFICIENT_COVERAGE' : 'STAFF_CALCULATION_REVIEW');
    }
    // This calculated accountability exists only in this stack frame. Neither the
    // source task nor its evaluation_snapshot/notificationBinding is changed.
    const reminder = planInAppSlaReminder({ asOf: source.asOf, calendar: prepared.calendar,
        policy: { version: SLA_PREVIEW_POLICY_VERSION, dueSoonMinutes: SLA_PREVIEW_DUE_SOON_MINUTES },
        task: { id: task.id, ownerUserId: task.ownerUserId, ownerActive: true, lifecycleRevision: task.lifecycleRevision,
            status: 'open', scopeClosed: false, serviceDueAt: task.serviceDueAt,
            accountability: { state: 'ready', ownerUserId: task.ownerUserId, lifecycleRevision: task.lifecycleRevision,
                calendarId: staff.calendarId, calendarVersion: staff.calendarVersion, staffDueAt: staff.staffDueAt,
                notifyAt: staff.notifyAt, lifecycleReview: 'clear' } } });
    if (reminder.state === 'not_ready') return held(reminder.reason === 'AS_OF_OUTSIDE_COVERAGE' ? 'INSUFFICIENT_COVERAGE' : 'REMINDER_REVIEW');
    const computed = { ...base, staffDueAt: staff.staffDueAt, notifyAt: staff.notifyAt, rule: staff.rule, calendarVersion: staff.calendarVersion };
    if (reminder.state === 'ready') return { ...computed, state: 'would_notify',
        reason: reminder.candidate.notificationType === 'due_soon' ? 'DUE_SOON' : 'OVERDUE', notificationType: reminder.candidate.notificationType };
    return { ...computed, state: 'scheduled', notificationType: null,
        reason: reminder.reason === 'OUTSIDE_WORKING_HOURS' ? 'OUTSIDE_WORKING_HOURS' : 'NOT_DUE_YET' };
}

/** Source has already passed the admin-only trusted RPC projection parser.
 * Never accept this source as a browser POST, and never use preview as a commit
 * token: a future writer must reload/lock current owner/calendar/evidence first.
 */
export function buildSlaPreview(source: SlaPreviewSource): SlaPreviewSnapshot {
    return { actor: { ...source.actor }, asOf: source.asOf, page: source.page, pageSize: 20, hasMore: source.hasMore,
        mode: 'dry_run', policyVersion: SLA_PREVIEW_POLICY_VERSION, dueSoonMinutes: SLA_PREVIEW_DUE_SOON_MINUTES,
        rows: source.tasks.map(task => evaluate(task, source)) };
}
