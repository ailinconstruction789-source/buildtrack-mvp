import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';

export const NOTIFICATION_CONTRACT_VERSION = 'notifications_v1';
export const NOTIFICATION_PAGE_SIZE = 50;
export const NOTIFICATION_MAX_PAGE = 1000;
export const NOTIFICATION_MAX_BODY_BYTES = 8 * 1024;
export type NotificationRole = 'sales' | 'admin' | 'owner';
export interface SalesNotification {
    readonly id: string;
    readonly taskId: string;
    readonly customerId: string;
    readonly interestId: string | null;
    readonly customerName: string;
    readonly projectName: string | null;
    readonly taskType: 'first_contact' | 'follow_up';
    readonly type: 'due_soon' | 'overdue';
    readonly availableAt: string;
    readonly createdAt: string;
    readonly readAt: string | null;
    readonly staffDueAt: string;
    readonly serviceDueAt: string;
}
export interface NotificationSnapshot {
    readonly actor: { readonly userId: string; readonly role: NotificationRole };
    readonly asOf: string;
    readonly page: number;
    readonly pageSize: 50;
    readonly hasMore: boolean;
    readonly unreadCount: number;
    readonly notifications: readonly SalesNotification[];
}
export interface NotificationReadInput { readonly notificationId: string }
export interface NotificationReadResult { readonly notificationId: string; readonly readAt: string }
export class NotificationInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor() { super('ข้อมูลแจ้งเตือนไม่ถูกต้อง กรุณาตรวจสอบคำขอ'); this.name = 'NotificationInputError'; }
}
export class NotificationProjectionError extends Error {
    constructor() { super('ข้อมูลแจ้งเตือนไม่ตรงกับรูปแบบหรือบัญชีที่ร้องขอ'); this.name = 'NotificationProjectionError'; }
}
const bad = (): never => { throw new NotificationInputError(); };
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
}
function uuid(value: unknown): string { return isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad(); }
function nullableUuid(value: unknown): string | null { return value === null ? null : uuid(value); }
const minInstant = parseEvidenceTimestamp('0001-01-01T00:00:00Z')!;
const maxInstant = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return bad();
    const parsed = parseEvidenceTimestamp(value);
    return parsed !== null && parsed >= minInstant && parsed <= maxInstant ? value : bad();
}
const instant = (value: string): bigint => parseEvidenceTimestamp(value)!;
function name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) return bad();
    return value;
}
export function parseNotificationPage(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= NOTIFICATION_MAX_PAGE && !Object.is(value, -0) ? value : bad();
}
export function parseNotificationQuery(url: string): number {
    try {
        const params = new URL(url).searchParams;
        if (Array.from(params.keys()).some(key => key !== 'page') || params.getAll('page').length > 1) return bad();
        if (!params.has('page')) return 0;
        const page = params.get('page')!;
        if (/[^0-9]/u.test(page) || !/^(0|[1-9][0-9]{0,3})$/.test(page)) return bad();
        return parseNotificationPage(Number(page));
    } catch { throw new NotificationInputError(); }
}
export function parseNotificationReadInput(value: unknown): NotificationReadInput {
    const row = record(value);
    if (Object.keys(row).length !== 1 || !Object.hasOwn(row, 'notificationId')) return bad();
    return { notificationId: uuid(row.notificationId) };
}
function notice(value: unknown, asOf: string): SalesNotification {
    const row = record(value);
    if (row.taskType !== 'first_contact' && row.taskType !== 'follow_up') return bad();
    if (row.type !== 'due_soon' && row.type !== 'overdue') return bad();
    const result: SalesNotification = {
        id: uuid(row.id), taskId: uuid(row.taskId), customerId: uuid(row.customerId), interestId: nullableUuid(row.interestId),
        customerName: name(row.customerName), projectName: row.projectName === null ? null : name(row.projectName),
        taskType: row.taskType, type: row.type, availableAt: timestamp(row.availableAt), createdAt: timestamp(row.createdAt),
        readAt: row.readAt === null ? null : timestamp(row.readAt), staffDueAt: timestamp(row.staffDueAt), serviceDueAt: timestamp(row.serviceDueAt),
    };
    if ((result.interestId === null) !== (result.projectName === null)) return bad();
    const created = instant(result.createdAt), due = instant(result.staffDueAt), bound = instant(asOf);
    if (instant(result.availableAt) > created || created > bound) return bad();
    if (result.readAt !== null && (instant(result.readAt) < created || instant(result.readAt) > bound)) return bad();
    if ((result.type === 'due_soon' && created > due) || (result.type === 'overdue' && created <= due)) return bad();
    return result;
}
/** Validated public projection only. Authority and current notification eligibility
 * are always resolved again by the trusted RPC; browser fields never grant access.
 */
export function parseNotificationSnapshot(value: unknown, expectedPage?: number, expectedActorId?: string, expectedRole?: NotificationRole): NotificationSnapshot {
    try {
        const root = record(value), actorRow = record(root.actor);
        if (actorRow.role !== 'sales' && actorRow.role !== 'admin' && actorRow.role !== 'owner') return bad();
        const actor: NotificationSnapshot['actor'] = { userId: uuid(actorRow.userId), role: actorRow.role };
        const asOf = timestamp(root.asOf), page = parseNotificationPage(root.page);
        if (expectedPage !== undefined && page !== parseNotificationPage(expectedPage)) return bad();
        if (expectedActorId !== undefined && actor.userId !== uuid(expectedActorId)) return bad();
        if (expectedRole !== undefined && actor.role !== expectedRole) return bad();
        if (root.pageSize !== NOTIFICATION_PAGE_SIZE || typeof root.hasMore !== 'boolean'
            || typeof root.unreadCount !== 'number' || !Number.isSafeInteger(root.unreadCount) || root.unreadCount < 0
            || !Array.isArray(root.notifications) || root.notifications.length > NOTIFICATION_PAGE_SIZE) return bad();
        const notifications = root.notifications.map(value => notice(value, asOf));
        if (new Set(notifications.map(row => row.id)).size !== notifications.length
            || (root.hasMore && notifications.length !== NOTIFICATION_PAGE_SIZE)
            || root.unreadCount < notifications.filter(row => row.readAt === null).length) return bad();
        return { actor, asOf, page, pageSize: NOTIFICATION_PAGE_SIZE, hasMore: root.hasMore, unreadCount: root.unreadCount, notifications };
    } catch { throw new NotificationProjectionError(); }
}
/** Mark-read is monotonic and intrinsically idempotent for this SAME notification.
 * A malformed success is uncertain, never proof that the acknowledgment failed.
 */
export function parseNotificationReadResult(value: unknown, input: NotificationReadInput): NotificationReadResult {
    try {
        const row = record(value), normalized = parseNotificationReadInput(input);
        const result = { notificationId: uuid(row.notificationId), readAt: timestamp(row.readAt) };
        if (result.notificationId !== normalized.notificationId) return bad();
        return result;
    } catch { throw new NotificationProjectionError(); }
}
