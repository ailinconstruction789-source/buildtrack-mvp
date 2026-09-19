import { describe, expect, it } from 'vitest';
import {
    NOTIFICATION_CONTRACT_VERSION, NOTIFICATION_MAX_BODY_BYTES, NOTIFICATION_PAGE_SIZE,
    NotificationInputError, NotificationProjectionError, parseNotificationPage, parseNotificationQuery,
    parseNotificationReadInput, parseNotificationReadResult, parseNotificationSnapshot,
} from '../notificationContracts';

const ACTOR = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const NOTICE = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const INTEREST = '00000000-0000-4000-8000-000000000004';
const BASE = '2026-09-17T12:00:00.123456+07:00';
const AFTER = '2026-09-17T12:00:00.123457+07:00';
function notification() {
    return { id: NOTICE, taskId: TASK, customerId: CUSTOMER, interestId: null, customerName: 'ลูกค้าทดสอบ', projectName: null,
        taskType: 'first_contact', type: 'due_soon', availableAt: BASE, createdAt: BASE, readAt: null,
        staffDueAt: BASE, serviceDueAt: '2026-09-17T11:00:00+07:00' };
}
function snapshot() {
    return { actor: { userId: ACTOR, role: 'sales' }, asOf: AFTER, page: 0, pageSize: 50,
        hasMore: false, unreadCount: 1, notifications: [notification()] };
}
describe('notification command/query contract', () => {
    it('uses bounded versioned inbox and no request receipt', () => {
        expect(NOTIFICATION_CONTRACT_VERSION).toBe('notifications_v1'); expect(NOTIFICATION_PAGE_SIZE).toBe(50);
        expect(NOTIFICATION_MAX_BODY_BYTES).toBe(8192);
        expect(parseNotificationReadInput({ notificationId: ACTOR.toUpperCase() })).toEqual({ notificationId: ACTOR });
    });
    it.each([0, 1, 50, 1000])('accepts canonical page %i', page => {
        expect(parseNotificationPage(page)).toBe(page); expect(parseNotificationQuery(`https://app.test/?page=${page}`)).toBe(page);
    });
    it('defaults omitted query to first page', () => { expect(parseNotificationQuery('https://app.test/')).toBe(0); });
    it.each([-0, -1, 1001, 1.1, NaN, Infinity, '0', null, undefined])('rejects noncanonical page %j', page => {
        expect(() => parseNotificationPage(page)).toThrow(NotificationInputError);
    });
    it.each(['page=', 'page=-0', 'page=-1', 'page=01', 'page=1.0', 'page=1e2', 'page=+1', 'page=1001', 'page=0%0A',
        'page=%200', 'page=1&page=1', 'recipient=other', 'page=1&pageSize=100', 'page=1&role=admin'])('rejects query %s', query => {
        expect(() => parseNotificationQuery(`https://app.test/?${query}`)).toThrow(NotificationInputError);
    });
    it('rejects malformed URL', () => { expect(() => parseNotificationQuery('bad')).toThrow(NotificationInputError); });
    it.each([null, [], {}, { notificationId: 'bad' }, { notificationId: `${NOTICE}\n` }, { notificationId: null },
        { notificationId: NOTICE, recipientId: ACTOR }, { notificationId: NOTICE, readAt: BASE }, { notificationId: NOTICE, requestId: TASK }])('rejects malformed/injected read command %j', input => {
        expect(() => parseNotificationReadInput(input)).toThrow(NotificationInputError);
    });
});

describe('strict own inbox public projection', () => {
    it('preserves microseconds and drops arbitrary private fields at every level', () => {
        const expected = snapshot();
        expect(parseNotificationSnapshot({ ...expected, privateDump: 'hidden', actor: { ...expected.actor, income: 99 },
            notifications: [{ ...notification(), message: 'private', phone: 'private', calendarReason: 'private', evaluationSnapshot: {} }] }, 0, ACTOR, 'sales')).toEqual(expected);
    });
    it.each(['sales', 'admin', 'owner'] as const)('allows own trusted %s projection shape without granting role authority', role => {
        expect(parseNotificationSnapshot({ ...snapshot(), actor: { userId: ACTOR.toUpperCase(), role } }, 0, ACTOR, role).actor).toEqual({ userId: ACTOR, role });
    });
    it('supports empty last pages and own unread total greater than page unread', () => {
        expect(parseNotificationSnapshot({ ...snapshot(), page: 1000, unreadCount: 300, notifications: [] }, 1000).notifications).toEqual([]);
    });
    it('supports project-scoped follow-up', () => {
        const row = { ...notification(), interestId: INTEREST, projectName: 'โครงการ A', taskType: 'follow_up' };
        expect(parseNotificationSnapshot({ ...snapshot(), notifications: [row] }).notifications[0]).toEqual(row);
    });
    it('requires project name for project-scoped work instead of mislabeling it central', () => {
        expect(() => parseNotificationSnapshot({ ...snapshot(), notifications: [{ ...notification(), interestId: INTEREST, projectName: null }] })).toThrow(NotificationProjectionError);
    });
    it('accepts read equality at creation/asOf and overdue one microsecond after due', () => {
        const row = { ...notification(), type: 'overdue', createdAt: AFTER, readAt: AFTER };
        expect(parseNotificationSnapshot({ ...snapshot(), unreadCount: 0, notifications: [row] }).notifications[0].readAt).toBe(AFTER);
    });
    it('compares equivalent offsets by exact instant', () => {
        const row = { ...notification(), availableAt: '2026-09-17T05:00:00.123456Z', readAt: '2026-09-17T05:00:00.123457Z' };
        expect(parseNotificationSnapshot({ ...snapshot(), notifications: [row] }).notifications[0]).toEqual(row);
    });
    it('hasMore requires a full unique page', () => {
        const notifications = Array.from({ length: 50 }, (_, index) => ({ ...notification(), id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
        expect(parseNotificationSnapshot({ ...snapshot(), hasMore: true, unreadCount: 50, notifications }).notifications).toHaveLength(50);
    });
    it.each([
        ['actor', null], ['actor', { userId: ACTOR, role: 'manager' }], ['actor', { userId: `${ACTOR}\n`, role: 'sales' }],
        ['page', -1], ['page', '0'], ['pageSize', 100], ['hasMore', 'false'], ['hasMore', true], ['unreadCount', -1],
        ['unreadCount', 0], ['unreadCount', 1.5], ['unreadCount', Number.MAX_SAFE_INTEGER + 1], ['notifications', null], ['asOf', BASE + '\n'],
    ])('rejects inconsistent root %s=%j', (field, value) => {
        expect(() => parseNotificationSnapshot({ ...snapshot(), [String(field)]: value })).toThrow(NotificationProjectionError);
    });
    it.each([
        ['id', `${NOTICE}\n`], ['taskId', null], ['customerId', 'bad'], ['interestId', 'bad'], ['customerName', ' '], ['customerName', '\ud800'],
        ['projectName', 'wrong central project'], ['taskType', 'visit'], ['type', 'owner_missing'], ['availableAt', AFTER],
        ['createdAt', '2026-09-17T12:00:00.123458+07:00'], ['readAt', '2026-09-17T12:00:00.123455+07:00'],
        ['readAt', '2026-09-17T12:00:00.123458+07:00'], ['staffDueAt', '2026-09-17T12:00:00.123455+07:00'],
        ['serviceDueAt', '2026-02-30T12:00:00Z'], ['staffDueAt', 'infinity'], ['createdAt', '2026-09-17'],
        ['createdAt', '2026-09-17T12:00:00.1234567+07:00'], ['createdAt', '2026-09-17T12:00:00-00:00'],
        ['createdAt', '0001-01-01T00:00:00+00:01'], ['serviceDueAt', '9999-12-31T23:59:59-00:01'],
    ])('rejects bad notification %s=%j', (field, value) => {
        expect(() => parseNotificationSnapshot({ ...snapshot(), notifications: [{ ...notification(), [String(field)]: value }] })).toThrow(NotificationProjectionError);
    });
    it('does not round exact due equality into overdue', () => {
        expect(() => parseNotificationSnapshot({ ...snapshot(), notifications: [{ ...notification(), type: 'overdue' }] })).toThrow(NotificationProjectionError);
    });
    it('rejects duplicate UUIDs even if case differs and oversized pages', () => {
        const row = { ...notification(), id: ACTOR };
        expect(() => parseNotificationSnapshot({ ...snapshot(), unreadCount: 2, notifications: [row, { ...row, id: ACTOR.toUpperCase() }] })).toThrow(NotificationProjectionError);
        expect(() => parseNotificationSnapshot({ ...snapshot(), unreadCount: 51, notifications: Array.from({ length: 51 }, () => notification()) })).toThrow(NotificationProjectionError);
    });
    it.each(['page', 'actor', 'role'] as const)('binds requested %s', field => {
        expect(() => parseNotificationSnapshot(snapshot(), field === 'page' ? 1 : 0, field === 'actor' ? CUSTOMER : ACTOR, field === 'role' ? 'admin' : 'sales')).toThrow(NotificationProjectionError);
    });
    it('requires every projected field rather than filling null defaults', () => {
        for (const key of Object.keys(snapshot())) {
            const value: Record<string, unknown> = snapshot(); delete value[key];
            expect(() => parseNotificationSnapshot(value), key).toThrow(NotificationProjectionError);
        }
        for (const key of Object.keys(notification())) {
            const row: Record<string, unknown> = notification(); delete row[key];
            expect(() => parseNotificationSnapshot({ ...snapshot(), notifications: [row] }), key).toThrow(NotificationProjectionError);
        }
    });
});

describe('monotonic notification read result projection', () => {
    const input = { notificationId: NOTICE };
    it('returns only matching notice and server read timestamp, preserving microseconds', () => {
        expect(parseNotificationReadResult({ notificationId: NOTICE, readAt: AFTER, privateDump: 'hidden' }, input)).toEqual({ notificationId: NOTICE, readAt: AFTER });
    });
    it.each([null, [], {}, { notificationId: CUSTOMER, readAt: AFTER }, { notificationId: NOTICE, readAt: null },
        { notificationId: NOTICE, readAt: `${AFTER}\n` }, { notificationId: NOTICE, readAt: 'infinity' }])('rejects uncertain success %j', result => {
        expect(() => parseNotificationReadResult(result, input)).toThrow(NotificationProjectionError);
    });
});
