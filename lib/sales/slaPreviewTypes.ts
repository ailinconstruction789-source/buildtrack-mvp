import type { RawSlaWorkCalendar } from './slaCalendar';

/** Trusted read-model shape, never an authorization claim or a write payload. */
export interface SlaPreviewSourceTask {
    readonly id: string;
    readonly customerId: string;
    readonly customerName: string;
    readonly ownerUserId: string | null;
    readonly ownerName: string | null;
    readonly scopeOwnerUserId: string;
    readonly ownerIsActiveSales: boolean;
    readonly lifecycleRevision: string;
    readonly scopeClosed: boolean;
    readonly recordOrigin: 'live' | 'legacy_import';
    readonly leadCreatedAt: string | null;
    readonly obligationStartedAt: string;
    readonly serviceDueAt: string;
    readonly taskCreatedAt: string;
    readonly initialContactHours: number | null;
    readonly creationProven: boolean;
    readonly ownerHistoryUnchanged: boolean;
    readonly lifecycleReviewPending: boolean;
    readonly hasContactEvidence: boolean;
    readonly hasCustomerPostponement: boolean;
    readonly hasExceptions: boolean;
    readonly calendar: RawSlaWorkCalendar | null;
}
export interface SlaPreviewSource {
    readonly actor: { readonly userId: string; readonly role: 'admin' };
    readonly asOf: string;
    readonly page: number;
    readonly pageSize: 20;
    readonly hasMore: boolean;
    readonly settings: { readonly version: number; readonly initialContactHours: number; readonly nextShiftResponseMinutes: number };
    readonly tasks: readonly SlaPreviewSourceTask[];
}
export const SLA_PREVIEW_REASONS = [
    'SCOPE_CLOSED', 'LEGACY_REVIEW', 'OWNER_NOT_READY', 'OWNER_REVIEW', 'MISSING_CREATION_EVIDENCE',
    'CONTACT_REVIEW', 'CUSTOMER_POSTPONEMENT', 'EXCEPTION_REVIEW', 'POLICY_REVIEW', 'SOURCE_TIME_REVIEW',
    'MISSING_CALENDAR', 'INVALID_CALENDAR', 'INSUFFICIENT_COVERAGE', 'STAFF_CALCULATION_REVIEW',
    'DUE_SOON', 'OVERDUE', 'NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS', 'REMINDER_REVIEW',
] as const;
export type SlaPreviewReason = typeof SLA_PREVIEW_REASONS[number];
export type SlaPreviewRule = 'out_of_hours' | 'service_deadline' | 'off_shift_service_deadline';
export interface SlaPreviewRow {
    readonly taskId: string;
    readonly customerId: string;
    readonly customerName: string;
    readonly ownerUserId: string | null;
    readonly ownerName: string | null;
    readonly serviceDueAt: string;
    readonly state: 'held' | 'scheduled' | 'would_notify';
    readonly reason: SlaPreviewReason;
    readonly staffDueAt: string | null;
    readonly notifyAt: string | null;
    readonly rule: SlaPreviewRule | null;
    readonly calendarVersion: string | null;
    readonly notificationType: 'due_soon' | 'overdue' | null;
}
export interface SlaPreviewSnapshot {
    readonly actor: { readonly userId: string; readonly role: 'admin' };
    readonly asOf: string;
    readonly page: number;
    readonly pageSize: 20;
    readonly hasMore: boolean;
    readonly mode: 'dry_run';
    readonly policyVersion: 'first_contact_preview_2026_09_17';
    readonly dueSoonMinutes: 30;
    readonly rows: readonly SlaPreviewRow[];
}
