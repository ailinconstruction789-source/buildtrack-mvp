// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, onAuthStateChange, unsubscribe, directRpc, from } = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), unsubscribe: vi.fn(), directRpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange }, rpc: directRpc, from } }));
import { NotificationClientError, loadNotificationSnapshot, markNotificationRead, notificationApi, watchNotificationActor } from '../notificationClient';
import type { NotificationReadInput } from '../notificationContracts';

const ACTOR = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const NOTICE = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T12:00:00.123456Z';
const input = { notificationId: NOTICE }, result = { notificationId: NOTICE, readAt: AT };
function snapshot(page = 0) {
    return { actor: { userId: ACTOR, role: 'sales' }, asOf: AT, page, pageSize: 50, hasMore: false, unreadCount: 1,
        notifications: [{ id: NOTICE, taskId: TASK, customerId: CUSTOMER, interestId: null, customerName: 'ลูกค้า', projectName: null,
            taskType: 'first_contact', type: 'due_soon', availableAt: AT, createdAt: AT, readAt: null, staffDueAt: AT, serviceDueAt: AT }] };
}
function session(userId: unknown = ACTOR, token = 'caller-token') { return { data: { session: { user: { id: userId }, access_token: token } }, error: null }; }
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
    const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
    return { promise, resolve, reject };
}
const fetchMock = vi.fn();
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session());
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
});
afterEach(() => { vi.unstubAllGlobals(); expect(directRpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); });

describe('private own inbox browser read transport', () => {
    it('exports default API using the same functions', () => { expect(notificationApi).toEqual({ read: loadNotificationSnapshot, markRead: markNotificationRead, watchActor: watchNotificationActor }); });
    it.each([0, 1, 1000])('loads bound page %i using app bearer API only', async page => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(page), privateDump: 'hidden' } }));
        expect(await loadNotificationSnapshot(page)).toEqual(snapshot(page));
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/sales-crm/notifications?page=${page}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        });
        expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('defaults to first page', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); expect(await loadNotificationSnapshot()).toEqual(snapshot());
    });
    it.each([-0, -1, 1001, 1.1, '0', null, NaN, Infinity])('rejects invalid page %j before session/network', async page => {
        await expect(loadNotificationSnapshot(page as number)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, 'bad', `${ACTOR}\n`, undefined])('requires captured valid user %j even for reads', async userId => {
        getSession.mockResolvedValue({ data: { session: { access_token: 'token', user: { id: userId } } }, error: null });
        await expect(loadNotificationSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([{ data: { session: null }, error: null }, { data: { session: { user: { id: ACTOR }, access_token: '' } }, error: null },
        { ...session(), error: { message: 'private error' } }])('requires session without auth error %j', async value => {
        getSession.mockResolvedValue(value); await expect(loadNotificationSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { ...snapshot(), page: 1 }, { ...snapshot(), actor: { userId: CUSTOMER, role: 'admin' } },
        { ...snapshot(), actor: { userId: ACTOR, role: 'manager' } }, { ...snapshot(), unreadCount: 0 }])('rejects incompatible/other-account snapshot %j', async data => {
        fetchMock.mockResolvedValue(Response.json({ data })); await expect(loadNotificationSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it.each([201, 202, 500])('requires exactly200, not%s', async status => {
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() }, { status })); await expect(loadNotificationSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('keeps read transport errors safe and read-specific', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private')); const error = await loadNotificationSnapshot().catch(value => value);
        expect(error.code).toBe('NETWORK_ERROR'); expect(error.message).not.toMatch(/private|ผลอ่านแล้ว|รหัสคำขอ/); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('captured actor and post-response identity privacy', () => {
    for (const action of ['read', 'write']) {
        for (const change of ['switch', 'logout']) {
            it.each(['success', 'malformed'])(`withholds ${action} after ${change} while awaiting %s JSON body`, async bodyState => {
                const started = deferred<void>(), body = deferred<unknown>(), response = Response.json({});
                vi.spyOn(response, 'json').mockImplementation(() => { started.resolve(); return body.promise; });
                fetchMock.mockResolvedValue(response);
                // Attach the rejection handler before resolving/rejecting the
                // deferred body; this also proves no watcher is required here.
                const outcome = (action === 'read' ? loadNotificationSnapshot() : markNotificationRead(input, ACTOR)).catch(error => error);
                await started.promise;
                expect(getSession).toHaveBeenCalledTimes(2);
                getSession.mockResolvedValue(change === 'switch' ? session(CUSTOMER, 'new-token') : { data: { session: null }, error: null });
                if (bodyState === 'success') body.resolve({ data: action === 'read' ? snapshot() : result });
                else body.reject(new Error('private malformed delayed body'));
                const error = await outcome;
                expect(error).toBeInstanceOf(NotificationClientError);
                expect(error).toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', status: 409, definitelyNotSaved: false });
                expect(error.message).not.toContain('private'); expect(getSession).toHaveBeenCalledTimes(3);
                expect(fetchMock).toHaveBeenCalledTimes(1); expect(onAuthStateChange).not.toHaveBeenCalled();
            });
        }
    }
    it.each(['read', 'write'])('withholds %s data after account switches during response', async action => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(CUSTOMER, 'new-token'));
        fetchMock.mockResolvedValue(Response.json({ data: action === 'read' ? snapshot() : result }));
        const task = action === 'read' ? loadNotificationSnapshot() : markNotificationRead(input, ACTOR);
        await expect(task).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', status: 409, definitelyNotSaved: false });
        expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer caller-token');
    });
    it.each(['read', 'write'])('withholds %s data if signed out during response', async action => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce({ data: { session: null }, error: null });
        fetchMock.mockResolvedValue(Response.json({ data: action === 'read' ? snapshot() : result }));
        await expect(action === 'read' ? loadNotificationSnapshot() : markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', definitelyNotSaved: false });
    });
    it.each(['malformed', 'network'])('checks identity even when response is %s', async kind => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(CUSTOMER));
        if (kind === 'malformed') fetchMock.mockResolvedValue(new Response('private malformed html', { status: 503 }));
        else fetchMock.mockRejectedValue(new Error('private network'));
        await expect(markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', definitelyNotSaved: false });
        expect(getSession).toHaveBeenCalledTimes(2); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('allows normal token refresh for same actor while preserving captured bearer', async () => {
        getSession.mockResolvedValueOnce(session(ACTOR.toUpperCase())).mockResolvedValueOnce(session(ACTOR, 'refreshed-token'));
        fetchMock.mockResolvedValue(Response.json({ data: result })); expect(await markNotificationRead(input, ACTOR)).toEqual(result);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer caller-token');
    });
    it('withholds success if post-response session recheck throws', async () => {
        getSession.mockResolvedValueOnce(session()).mockRejectedValueOnce(new Error('private session data'));
        fetchMock.mockResolvedValue(Response.json({ data: result })); const error = await markNotificationRead(input, ACTOR).catch(value => value);
        expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotSaved: false }); expect(error.message).not.toContain('private');
    });
    it.each([CUSTOMER, null, undefined, `${ACTOR}\n`])('blocks pre-POST actor mismatch %j without any request', async userId => {
        getSession.mockResolvedValue({ data: { session: { user: { id: userId }, access_token: 'new-token' } }, error: null });
        await expect(markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', status: 409, definitelyNotSaved: true }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(['', CUSTOMER, `${ACTOR}\n`, undefined])('requires loaded expected actor %j', async expectedActorId => {
        await expect(markNotificationRead(input, expectedActorId as string)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('notification UI actor invalidation subscription', () => {
    function listener() { return onAuthStateChange.mock.calls[0][0] as (event: string, value: { user: { id: unknown } } | null) => void; }
    it('subscribes without network/session reads and preserves same-user refresh and casing', () => {
        const invalidated = vi.fn(), stop = watchNotificationActor(ACTOR.toUpperCase(), invalidated);
        listener()('INITIAL_SESSION', { user: { id: ACTOR } }); listener()('TOKEN_REFRESHED', { user: { id: ACTOR.toUpperCase() } });
        expect(invalidated).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(getSession).not.toHaveBeenCalled();
        stop(); stop(); expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    it.each([null, undefined, 'bad', `${ACTOR}\n`, CUSTOMER])('invalidates malformed/different actor %j exactly once', userId => {
        const invalidated = vi.fn(); watchNotificationActor(ACTOR, invalidated);
        listener()('SIGNED_IN', { user: { id: userId } }); listener()('SIGNED_OUT', null);
        expect(invalidated).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled(); expect(getSession).not.toHaveBeenCalled();
    });
    it('invalidates signedout and ignores late listener delivery after cleanup', () => {
        const invalidated = vi.fn(), stop = watchNotificationActor(ACTOR, invalidated);
        stop(); listener()('SIGNED_OUT', null); expect(invalidated).not.toHaveBeenCalled();
        watchNotificationActor(ACTOR, invalidated);
        const nextListener = onAuthStateChange.mock.calls[1][0] as ReturnType<typeof listener>;
        nextListener('SIGNED_OUT', null); expect(invalidated).toHaveBeenCalledTimes(1);
    });
    it('fails closed for invalid expected actor without registering', () => {
        const invalidated = vi.fn(), stop = watchNotificationActor('bad', invalidated);
        expect(invalidated).toHaveBeenCalledTimes(1); expect(onAuthStateChange).not.toHaveBeenCalled(); expect(() => stop()).not.toThrow();
    });
    it.each([null, {}, { data: {} }, { data: { subscription: {} } }])('fails closed for unsupported subscription result %j', result => {
        onAuthStateChange.mockReturnValue(result); const invalidated = vi.fn(), stop = watchNotificationActor(ACTOR, invalidated);
        expect(invalidated).toHaveBeenCalledTimes(1); expect(() => stop()).not.toThrow();
    });
    it('fails closed for setup throws and safely tolerates local cleanup failure', () => {
        onAuthStateChange.mockImplementationOnce(() => { throw new Error('private'); }); const invalidated = vi.fn();
        expect(() => watchNotificationActor(ACTOR, invalidated)).not.toThrow(); expect(invalidated).toHaveBeenCalledTimes(1);
        unsubscribe.mockImplementationOnce(() => { throw new Error('local cleanup'); }); const stop = watchNotificationActor(ACTOR, vi.fn());
        expect(() => stop()).not.toThrow();
    });
});

describe('monotonic same-notice acknowledgment transport', () => {
    it('sends exactly normalized ID with no actor/time/receipt and strips private result fields', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { notificationId: ACTOR, readAt: AT, privateDump: 'hidden' } }));
        expect(await markNotificationRead({ notificationId: ACTOR.toUpperCase() }, ACTOR.toUpperCase())).toEqual({ notificationId: ACTOR, readAt: AT });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/sales-crm/notifications', {
            method: 'POST', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ notificationId: ACTOR }),
        });
    });
    it.each([null, {}, { notificationId: 'bad' }, { notificationId: `${NOTICE}\n` }, { ...input, readAt: AT }, { ...input, recipientId: ACTOR },
        { ...input, requestId: TASK }])('rejects invalid/injected input %j before auth/network', async value => {
        await expect(markNotificationRead(value as NotificationReadInput, ACTOR)).rejects.toMatchObject({ code: 'INVALID_INPUT', definitelyNotSaved: true });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('keeps network failure uncertain, never retries automatically, explicit retry uses identical ID', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private lost response'));
        await expect(markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'NETWORK_ERROR', definitelyNotSaved: false }); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: result })); expect(await markNotificationRead(input, ACTOR)).toEqual(result);
        expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    });
    it.each([[200, null], [200, {}], [200, { ...result, notificationId: CUSTOMER }], [200, { ...result, readAt: null }],
        [200, { ...result, readAt: `${AT}\n` }], [201, result], [202, result], [500, result]])('treats malformed success status=%j,data=%j as uncertain', async (status, data) => {
        fetchMock.mockResolvedValue(Response.json({ data }, { status: Number(status) }));
        await expect(markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it.each([['INVALID_INPUT', 400], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403], ['NOT_AVAILABLE', 404], ['ACTOR_CHANGED', 409],
        ['PAYLOAD_TOO_LARGE', 413], ['UNSUPPORTED_MEDIA_TYPE', 415], ['SETUP_REQUIRED', 503], ['FEATURE_DISABLED', 503]])('recognizes exact safe rejection %s/%i but does not display arbitrary backend text', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private raw SQL token=secret' } }, { status: Number(status) }));
        const error = await markNotificationRead(input, ACTOR).catch(value => value);
        expect(error).toBeInstanceOf(NotificationClientError); expect(error).toMatchObject({ code, status, definitelyNotSaved: true }); expect(error.message).not.toMatch(/private|SQL|secret/);
    });
    it.each([['SERVICE_UNAVAILABLE', 503], ['READ_UNAVAILABLE', 503]])('recognizes uncertain safe failure %s/%i', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private' } }, { status: Number(status) }));
        const error = await markNotificationRead(input, ACTOR).catch(value => value); expect(error).toMatchObject({ code, definitelyNotSaved: false }); expect(error.message).not.toContain('private');
    });
    it.each([['INVALID_INPUT', 503], ['FEATURE_DISABLED', 409], ['UNKNOWN_PROXY', 400], ['toString', 409], ['constructor', 400],
        ['ACTOR_CHANGED_AFTER_REQUEST', 409], ['SERVICE_UNAVAILABLE', 400]])('does not trust unknown/mismatched code status %s/%i', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private' } }, { status: Number(status) }));
        await expect(markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it.each([{ status: 200, body: { error: { code: 'FORBIDDEN', message: 'private' } } },
        { status: 403, body: { data: result, error: { code: 'FORBIDDEN', message: 'private' } } },
        { status: 400, body: { error: { code: '', message: 'private' } } }, { status: 400, body: null },
        { status: 400, body: { error: { code: 'INVALID_INPUT', message: null } } }])('keeps ambiguous envelopes %j uncertain', async ({ status, body }) => {
        fetchMock.mockResolvedValue(Response.json(body, { status }));
        await expect(markNotificationRead(input, ACTOR)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it('sanitizes nonJSON and session transport failures', async () => {
        fetchMock.mockResolvedValue(new Response('private html', { status: 503 }));
        let error = await markNotificationRead(input, ACTOR).catch(value => value); expect(error).toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false }); expect(error.message).not.toContain('private');
        vi.clearAllMocks(); getSession.mockRejectedValue(new Error('private'));
        error = await markNotificationRead(input, ACTOR).catch(value => value); expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotSaved: false }); expect(error.message).not.toContain('private'); expect(fetchMock).not.toHaveBeenCalled();
    });
});
