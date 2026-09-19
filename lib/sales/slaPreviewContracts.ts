import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import type { RawSlaWorkCalendar, RawSlaWorkPeriod } from './slaCalendar';
import { SLA_PREVIEW_REASONS, type SlaPreviewRow, type SlaPreviewSnapshot, type SlaPreviewSource, type SlaPreviewSourceTask } from './slaPreviewTypes';

export const SLA_PREVIEW_CONTRACT_VERSION = 'first_contact_preview_v1';
export const SLA_PREVIEW_PAGE_SIZE = 20;
export const SLA_PREVIEW_MAX_PAGE = 1000;
export class SlaPreviewInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor() { super('ข้อมูลคำขอดูตัวอย่าง SLA ไม่ถูกต้อง'); this.name = 'SlaPreviewInputError'; }
}
export class SlaPreviewProjectionError extends Error {
    constructor() { super('ข้อมูลตัวอย่าง SLA ไม่ตรงกับขอบเขตหรือรูปแบบที่กำหนด'); this.name = 'SlaPreviewProjectionError'; }
}
const bad = (): never => { throw new SlaPreviewProjectionError(); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const uuid = (value: unknown): string => isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad();
const nullableUuid = (value: unknown): string | null => value === null ? null : uuid(value);
const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : bad();
const positiveInteger = (value: unknown): number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : bad();
const instant = (value: string): bigint => parseEvidenceTimestamp(value)!;
const minimum = instant('0001-01-01T00:00:00Z'), maximum = instant('9999-12-31T23:59:59.999999Z');
const maximumCoverage = BigInt(366 * 24 * 60 * 60) * BigInt(1_000_000);
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return bad();
    const parsed = parseEvidenceTimestamp(value);
    return parsed !== null && parsed >= minimum && parsed <= maximum ? value : bad();
}
function name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) return bad();
    return value;
}
export function parseSlaPreviewPage(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > SLA_PREVIEW_MAX_PAGE || Object.is(value, -0)) throw new SlaPreviewInputError();
    return value;
}
export function parseSlaPreviewQuery(url: string): number {
    try {
        const params = new URL(url).searchParams;
        if (Array.from(params.keys()).some(key => key !== 'page') || params.getAll('page').length > 1) throw new SlaPreviewInputError();
        if (!params.has('page')) return 0;
        const page = params.get('page')!;
        if (/[^0-9]/u.test(page) || !/^(0|[1-9][0-9]{0,3})$/.test(page)) throw new SlaPreviewInputError();
        return parseSlaPreviewPage(Number(page));
    } catch { throw new SlaPreviewInputError(); }
}
function common(root: Record<string, unknown>, expectedPage?: number, expectedActorId?: string) {
    const actorRow = record(root.actor);
    if (actorRow.role !== 'admin') return bad();
    const actor: SlaPreviewSource['actor'] = { userId: uuid(actorRow.userId), role: 'admin' };
    const asOf = timestamp(root.asOf), page = parseSlaPreviewPage(root.page);
    if (expectedActorId !== undefined && actor.userId !== uuid(expectedActorId)) return bad();
    if (expectedPage !== undefined && page !== parseSlaPreviewPage(expectedPage)) return bad();
    if (root.pageSize !== SLA_PREVIEW_PAGE_SIZE) return bad();
    return { actor, asOf, page, pageSize: SLA_PREVIEW_PAGE_SIZE as 20, hasMore: boolean(root.hasMore) };
}
/** Syntax and resource bounds only. Incomplete/overlapping calendars are evidence
 * for a held preview, not grounds for making up a usable work schedule here. */
function calendar(value: unknown): RawSlaWorkCalendar | null {
    if (value === null) return null;
    const row = record(value), rawCoverage = record(row.coverage);
    const coverage = { startsAt: timestamp(rawCoverage.startsAt), endsAt: timestamp(rawCoverage.endsAt), complete: boolean(rawCoverage.complete) };
    const span = instant(coverage.endsAt) - instant(coverage.startsAt);
    if (span <= BigInt(0) || span > maximumCoverage || !Array.isArray(row.periods) || row.periods.length > 400) return bad();
    const periods = row.periods.map(value => {
        const period = record(value);
        if (period.type !== 'work' && period.type !== 'leave' && period.type !== 'break') return bad();
        const result: RawSlaWorkPeriod = { id: uuid(period.id), salesUserId: uuid(period.salesUserId), type: period.type,
            startsAt: timestamp(period.startsAt), endsAt: timestamp(period.endsAt) };
        if (instant(result.endsAt) <= instant(result.startsAt)) return bad();
        return result;
    });
    return { id: uuid(row.id), version: uuid(row.version), ownerUserId: uuid(row.ownerUserId), coverage, periods };
}
function sourceTask(value: unknown): SlaPreviewSourceTask {
    const row = record(value);
    if (row.recordOrigin !== 'live' && row.recordOrigin !== 'legacy_import') return bad();
    const result: SlaPreviewSourceTask = {
        id: uuid(row.id), customerId: uuid(row.customerId), customerName: name(row.customerName),
        ownerUserId: nullableUuid(row.ownerUserId), ownerName: row.ownerName === null ? null : name(row.ownerName),
        scopeOwnerUserId: uuid(row.scopeOwnerUserId), ownerIsActiveSales: boolean(row.ownerIsActiveSales),
        lifecycleRevision: uuid(row.lifecycleRevision), scopeClosed: boolean(row.scopeClosed), recordOrigin: row.recordOrigin,
        leadCreatedAt: row.leadCreatedAt === null ? null : timestamp(row.leadCreatedAt),
        obligationStartedAt: timestamp(row.obligationStartedAt), serviceDueAt: timestamp(row.serviceDueAt), taskCreatedAt: timestamp(row.taskCreatedAt),
        initialContactHours: row.initialContactHours === null ? null : positiveInteger(row.initialContactHours),
        creationProven: boolean(row.creationProven), ownerHistoryUnchanged: boolean(row.ownerHistoryUnchanged),
        lifecycleReviewPending: boolean(row.lifecycleReviewPending), hasContactEvidence: boolean(row.hasContactEvidence),
        hasCustomerPostponement: boolean(row.hasCustomerPostponement), hasExceptions: boolean(row.hasExceptions), calendar: calendar(row.calendar),
    };
    if (result.ownerUserId === null && (result.ownerName !== null || result.ownerIsActiveSales)) return bad();
    // Semantically contradictory/future source times stay in the queue. The
    // engine reports SOURCE_TIME_REVIEW for that row without hiding other rows.
    return result;
}
/** Called on the server only after verified Admin/source RPC authorization. This
 * parser establishes shape, never provenance or permission by itself. */
export function parseSlaPreviewSource(value: unknown, expectedPage?: number, expectedActorId?: string): SlaPreviewSource {
    try {
        const root = record(value), base = common(root, expectedPage, expectedActorId), settings = record(root.settings);
        if (!Array.isArray(root.tasks) || root.tasks.length > SLA_PREVIEW_PAGE_SIZE) return bad();
        const tasks = root.tasks.map(sourceTask);
        if (new Set(tasks.map(task => task.id)).size !== tasks.length || (base.hasMore && tasks.length !== SLA_PREVIEW_PAGE_SIZE)) return bad();
        return { ...base, settings: { version: positiveInteger(settings.version), initialContactHours: positiveInteger(settings.initialContactHours),
            nextShiftResponseMinutes: positiveInteger(settings.nextShiftResponseMinutes) }, tasks };
    } catch { throw new SlaPreviewProjectionError(); }
}
const scheduledReasons = ['NOT_DUE_YET', 'OUTSIDE_WORKING_HOURS'];
const notificationReasons = ['DUE_SOON', 'OVERDUE'];
function previewRow(value: unknown, asOf: string): SlaPreviewRow {
    const row = record(value);
    if (row.state !== 'held' && row.state !== 'scheduled' && row.state !== 'would_notify') return bad();
    if (typeof row.reason !== 'string' || !SLA_PREVIEW_REASONS.some(reason => reason === row.reason)) return bad();
    if (row.rule !== null && row.rule !== 'out_of_hours' && row.rule !== 'service_deadline' && row.rule !== 'off_shift_service_deadline') return bad();
    if (row.notificationType !== null && row.notificationType !== 'due_soon' && row.notificationType !== 'overdue') return bad();
    const result: SlaPreviewRow = {
        taskId: uuid(row.taskId), customerId: uuid(row.customerId), customerName: name(row.customerName),
        ownerUserId: nullableUuid(row.ownerUserId), ownerName: row.ownerName === null ? null : name(row.ownerName),
        serviceDueAt: timestamp(row.serviceDueAt), state: row.state, reason: row.reason as SlaPreviewRow['reason'],
        staffDueAt: row.staffDueAt === null ? null : timestamp(row.staffDueAt), notifyAt: row.notifyAt === null ? null : timestamp(row.notifyAt),
        rule: row.rule, calendarVersion: nullableUuid(row.calendarVersion), notificationType: row.notificationType,
    };
    if (result.ownerUserId === null && result.ownerName !== null) return bad();
    if (result.state === 'held') {
        if (scheduledReasons.includes(result.reason) || notificationReasons.includes(result.reason)
            || [result.staffDueAt, result.notifyAt, result.rule, result.calendarVersion, result.notificationType].some(value => value !== null)) return bad();
    } else {
        if (result.ownerUserId === null || result.staffDueAt === null || result.notifyAt === null || result.rule === null || result.calendarVersion === null) return bad();
        if (instant(result.notifyAt) > instant(result.staffDueAt)) return bad();
        if (result.state === 'scheduled') {
            if (!scheduledReasons.includes(result.reason) || result.notificationType !== null) return bad();
        } else {
            if ((result.reason !== 'DUE_SOON' || result.notificationType !== 'due_soon')
                && (result.reason !== 'OVERDUE' || result.notificationType !== 'overdue')) return bad();
            const at = instant(asOf), due = instant(result.staffDueAt);
            if (at < instant(result.notifyAt) || (result.notificationType === 'due_soon' && (at > due || at < due - BigInt(30 * 60 * 1_000_000)))
                || (result.notificationType === 'overdue' && at <= due)) return bad();
        }
    }
    return result;
}
/** Exact public projection: never returns raw calendar, evidence flags, policy
 * settings, HR reasons, contact details, delivery keys or write-ready commands. */
export function parseSlaPreviewSnapshot(value: unknown, expectedPage?: number, expectedActorId?: string): SlaPreviewSnapshot {
    try {
        const root = record(value), base = common(root, expectedPage, expectedActorId);
        if (root.mode !== 'dry_run' || root.policyVersion !== 'first_contact_preview_2026_09_17' || root.dueSoonMinutes !== 30
            || !Array.isArray(root.rows) || root.rows.length > SLA_PREVIEW_PAGE_SIZE) return bad();
        const rows = root.rows.map(value => previewRow(value, base.asOf));
        if (new Set(rows.map(row => row.taskId)).size !== rows.length || (base.hasMore && rows.length !== SLA_PREVIEW_PAGE_SIZE)) return bad();
        return { ...base, mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17', dueSoonMinutes: 30, rows };
    } catch { throw new SlaPreviewProjectionError(); }
}
