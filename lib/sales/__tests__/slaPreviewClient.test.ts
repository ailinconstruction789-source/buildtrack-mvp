import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, watchActor } = vi.hoisted(() => ({ getSession: vi.fn(), watchActor: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
vi.mock('../notificationClient', () => ({ watchNotificationActor: watchActor }));
import { SlaPreviewClientError, loadSlaPreviewSnapshot, slaPreviewApi } from '../slaPreviewClient';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002', CUSTOMER = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T02:45:00.123456Z';
const fetchMock = vi.fn();
function snapshot(page = 0) { return { actor: { userId: ADMIN, role: 'admin' }, asOf: AT, page, pageSize: 20, hasMore: false,
    mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17', dueSoonMinutes: 30,
    rows: [{ taskId: TASK, customerId: CUSTOMER, customerName: 'ลูกค้า', ownerUserId: OTHER, ownerName: 'Sales', serviceDueAt: AT,
        state: 'held', reason: 'MISSING_CALENDAR', staffDueAt: null, notifyAt: null, rule: null, calendarVersion: null, notificationType: null }] }; }
function session(userId: unknown = ADMIN, token = 'caller-token') { return { data: { session: { user: { id: userId }, access_token: token } }, error: null }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());

describe('read-only preview client', () => {
    it('exposes read and privacywatcher only; never mutates notifications', () => {
        expect(slaPreviewApi).toEqual({ read: loadSlaPreviewSnapshot, watchActor });
        const invalidated = vi.fn(); slaPreviewApi.watchActor?.(ADMIN, invalidated); expect(watchActor).toHaveBeenCalledWith(ADMIN, invalidated);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([0, 1, 1000])('reads canonical page%s with captured bearer and strips extras', async page => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(page), settings: {}, source: { private: true } } }));
        expect(await loadSlaPreviewSnapshot(page)).toEqual(snapshot(page));
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/sales-crm/sla-preview?page=${page}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        }); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('defaults to pagezero', async () => { fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); expect(await loadSlaPreviewSnapshot()).toEqual(snapshot()); });
    it.each([-0, -1, 1001, 1.1, NaN, Infinity, '0', null])('rejects invalid page%j without network', async page => {
        await expect(loadSlaPreviewSnapshot(page as number)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 }); expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, undefined, 'bad', `${ADMIN}\n`])('requires valid actor%j before read', async userId => {
        getSession.mockResolvedValue({ data: { session: { access_token: 'token', user: { id: userId } } }, error: null });
        await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([{ data: { session: null }, error: null }, session(ADMIN, ''), { ...session(), error: { message: 'private' } }])('rejects invalid session%j', async value => {
        getSession.mockResolvedValue(value); await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('does not trust storedbrowser role, requires server Adminprojection', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(), actor: { userId: ADMIN, role: 'sales' } } }));
        await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it.each([null, [], {}, { ...snapshot(), page: 1 }, { ...snapshot(), actor: { userId: OTHER, role: 'admin' } },
        { ...snapshot(), mode: 'live' }, { ...snapshot(), dueSoonMinutes: 60 }])('rejects malformed projection%j', async data => {
        fetchMock.mockResolvedValue(Response.json({ data })); await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
});
describe('account changes across headers and streaming bodies', () => {
    it.each(['switch', 'signout'])('withholds response on%s before JSONparse', async event => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(event === 'switch' ? session(OTHER) : { data: { session: null }, error: null });
        const json = vi.fn().mockResolvedValue({ data: snapshot() }); fetchMock.mockResolvedValue({ ok: true, status: 200, json });
        await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', status: 409 }); expect(json).not.toHaveBeenCalled();
    });
    it.each(['resolve', 'reject'])('rechecks after body%s if account switched while body pending', async outcome => {
        const body = deferred<unknown>(), entered = deferred<void>();
        fetchMock.mockResolvedValue({ status: 200, ok: true, json: () => { entered.resolve(); return body.promise; } });
        const attempt = loadSlaPreviewSnapshot(); const check = expect(attempt).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' });
        await entered.promise; getSession.mockResolvedValue(session(OTHER));
        if (outcome === 'resolve') body.resolve({ data: snapshot() }); else body.reject(new Error('private body'));
        await check; expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('detects changed account when fetchthrows instead of keeping a stale snapshot', async () => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER)); fetchMock.mockRejectedValue(new Error('private network'));
        await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' });
    });
    it.each([1, 2])('fails closed when identity recheck%s throws', async index => {
        getSession.mockResolvedValueOnce(session()); if (index === 2) getSession.mockResolvedValueOnce(session());
        getSession.mockRejectedValueOnce(new Error('private session')); fetchMock.mockResolvedValue(Response.json({ data: snapshot() }));
        const error = await loadSlaPreviewSnapshot().catch(error => error); expect(error).toBeInstanceOf(SlaPreviewClientError);
        expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE' }); expect(error.message).not.toContain('private');
    });
    it('allows same-user tokenrefresh/casechanges without replacing captured bearer', async () => {
        getSession.mockResolvedValueOnce(session(ADMIN.toUpperCase())).mockResolvedValue(session(ADMIN, 'refreshed-token'));
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); expect(await loadSlaPreviewSnapshot()).toEqual(snapshot());
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer caller-token');
    });
});
describe('safe read errors without retries or writes', () => {
    it.each([['INVALID_INPUT', 400], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403], ['FEATURE_DISABLED', 503], ['SETUP_REQUIRED', 503], ['READ_UNAVAILABLE', 503]])('accepts known%s error with exactstatus', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private raw SQL token=secret' } }, { status: Number(status) }));
        const error = await loadSlaPreviewSnapshot().catch(error => error); expect(error).toMatchObject({ code, status }); expect(error.message).not.toMatch(/private|raw SQL|token=secret/);
    });
    it.each([[400, { error: { code: 'FORBIDDEN', message: 'private' } }], [500, { error: { code: 'unknown', message: 'private' } }],
        [200, { error: { code: 'FORBIDDEN', message: 'private' } }], [200, { data: snapshot(), error: {} }], [201, { data: snapshot() }]])('rejects contradictory envelope status%s', async (status, body) => {
        fetchMock.mockResolvedValue(Response.json(body, { status: Number(status) })); await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('sanitizes nonJSONbody and transporterrors without automatic retry', async () => {
        fetchMock.mockResolvedValueOnce(new Response('private html', { status: 503 })).mockRejectedValueOnce(new Error('private network'));
        await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
        await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'NETWORK_ERROR' }); expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('sanitizes initial sessiontransporterror', async () => {
        getSession.mockRejectedValue(new Error('private token=secret')); await expect(loadSlaPreviewSnapshot()).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' }); expect(fetchMock).not.toHaveBeenCalled();
    });
});
