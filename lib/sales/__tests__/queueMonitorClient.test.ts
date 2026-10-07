import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, watchActor } = vi.hoisted(() => ({ getSession: vi.fn(), watchActor: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
vi.mock('../notificationClient', () => ({ watchNotificationActor: watchActor }));
import { QueueMonitorClientError, loadQueueMonitorSnapshot, queueMonitorApi } from '../queueMonitorClient';
import { QUEUE_MONITOR_CONTRACT_VERSION } from '../queueMonitorContracts';

const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const AT = '2026-09-23T02:45:00.123456Z';
const fetchMock = vi.fn();
function snapshot() {
    return { contractVersion: QUEUE_MONITOR_CONTRACT_VERSION, actor: { userId: ADMIN, role: 'admin' }, asOf: AT, readOnly: true,
        targetSeconds: 300, deliveryLatencySeconds: null, sweepAgeSeconds: null,
        gates: { processing: false, cycle: false, worker: false, dispatcher: false, burst: false },
        candidates: { sampleCount: 895, exact: true, scanLimit: 901, storedHeldCount: 10, withoutStoredReviewCount: 885 },
        cursor: { afterCreatedAt: null, afterTaskId: null }, currentRequest: null };
}
function session(userId: unknown = ADMIN, token: unknown = 'caller-token') {
    return { data: { session: { user: { id: userId }, access_token: token } }, error: null };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());

describe('Admin queue observation client and captured browser identity', () => {
    it('exports only read and privacy watcher without initiating any request', () => {
        expect(queueMonitorApi).toEqual({ read: loadQueueMonitorSnapshot, watchActor });
        const invalidated = vi.fn(); queueMonitorApi.watchActor?.(ADMIN, invalidated);
        expect(watchActor).toHaveBeenCalledWith(ADMIN, invalidated); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('loads with a no-query no-store GET and strips private fields at every level', async () => {
        const base = snapshot(); fetchMock.mockResolvedValue(Response.json({ data: { ...base, rawLedger: {}, actor: { ...base.actor, email: 'private' },
            gates: { ...base.gates, secret: 'private' }, candidates: { ...base.candidates, tasks: [{ income: 99 }] },
            cursor: { ...base.cursor, customer: 'private' } } }));
        expect(await loadQueueMonitorSnapshot()).toEqual(base);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/sales-crm/queue-monitor', {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        }); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('accepts uppercase expected UUID without sending an account selector to the server', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() }));
        expect(await loadQueueMonitorSnapshot(ADMIN.toUpperCase())).toEqual(snapshot());
        expect(fetchMock.mock.calls[0][0]).toBe('/api/sales-crm/queue-monitor');
    });
    it.each([OTHER, '', `${ADMIN}\n`, null])('rejects mismatched expected actor %j before network', async expected => {
        await expect(loadQueueMonitorSnapshot(expected as string)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', status: 409 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, 'bad', OTHER, `${ADMIN}\n`])('rejects invalid or changed session actor %j when bound', async userId => {
        getSession.mockResolvedValue(session(userId));
        await expect(loadQueueMonitorSnapshot(ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, 'bad', `${ADMIN}\n`])('rejects malformed session actor %j on the initial read', async userId => {
        getSession.mockResolvedValue(session(userId));
        await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([{ data: { session: null }, error: null }, session(ADMIN, ''), session(ADMIN, 42), { ...session(), error: { message: 'private' } }])('rejects unavailable session before network %j', async value => {
        getSession.mockResolvedValue(value); await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('redacts an initial session exception without requesting', async () => {
        getSession.mockRejectedValueOnce(new Error('private token'));
        const error = await loadQueueMonitorSnapshot().catch(error => error);
        expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE' }); expect(error.message).not.toContain('private'); expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('actor rechecks around headers, delayed JSON and network errors', () => {
    it.each(['switch', 'signout', 'invalid-token'])('withholds data on %s before JSON parsing', async event => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(event === 'switch' ? session(OTHER)
            : event === 'invalid-token' ? session(ADMIN, 42) : { data: { session: null }, error: null });
        const json = vi.fn().mockResolvedValue({ data: snapshot() }); fetchMock.mockResolvedValue({ ok: true, status: 200, json });
        await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', status: 409 }); expect(json).not.toHaveBeenCalled();
    });
    it.each(['resolve', 'reject'])('checks account again when a delayed body will %s', async outcome => {
        const body = deferred<unknown>(), entered = deferred<void>();
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => { entered.resolve(); return body.promise; } });
        const attempt = loadQueueMonitorSnapshot(); const assertion = expect(attempt).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' });
        await entered.promise; getSession.mockResolvedValue(session(OTHER));
        if (outcome === 'resolve') body.resolve({ data: snapshot() }); else body.reject(new Error('private malformed body'));
        await assertion; expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('checks identity when fetch fails and never returns a stale-account network result', async () => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER)); fetchMock.mockRejectedValue(new Error('private network'));
        await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' }); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('hides a server error from a changed account', async () => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER));
        fetchMock.mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN', message: 'private' } }, { status: 403 }));
        await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' });
    });
    it.each(['headers', 'body', 'network'])('fails closed if session recheck throws after %s', async phase => {
        getSession.mockResolvedValueOnce(session());
        if (phase === 'body') getSession.mockResolvedValueOnce(session());
        getSession.mockRejectedValueOnce(new Error('private session'));
        if (phase === 'network') fetchMock.mockRejectedValueOnce(new Error('private network'));
        else fetchMock.mockResolvedValue(Response.json({ data: snapshot() }));
        const error = await loadQueueMonitorSnapshot().catch(error => error);
        expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE' }); expect(error.message).not.toContain('private');
    });
    it('allows a same-actor token refresh and retains the captured bearer', async () => {
        getSession.mockResolvedValueOnce(session(ADMIN.toUpperCase())).mockResolvedValue(session(ADMIN, 'refreshed-token'));
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); expect(await loadQueueMonitorSnapshot(ADMIN)).toEqual(snapshot());
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer caller-token');
    });
});

describe('whitelisted snapshots and sanitized failures never produce queue commands', () => {
    it.each([null, [], {}, { ...snapshot(), actor: { userId: OTHER, role: 'admin' } }, { ...snapshot(), actor: { userId: ADMIN, role: 'sales' } },
        { ...snapshot(), readOnly: false }, { ...snapshot(), deliveryLatencySeconds: 0 }, { ...snapshot(), currentRequest: {} },
        { ...snapshot(), asOf: `${AT}\n` }, { ...snapshot(), candidates: { ...snapshot().candidates, exact: false } }])('rejects malformed or wrong-scope snapshot %j', async data => {
        fetchMock.mockResolvedValue(Response.json({ data })); await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('strips raw completed receipt evaluations and error fields', async () => {
        const currentRequest = { requestId: ADMIN, attemptId: OTHER, attemptCount: 1, status: 'completed', policyVersion: 'bounded_burst_v2',
            createdAt: AT, preparedAt: AT, nextAttemptAt: AT, completedAt: AT, lastErrorCode: null,
            receipt: { startedAt: AT, finishedAt: AT, processedCount: 10, sweepFinished: false, heldCount: 2, notifiedCount: 8 } };
        fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(), currentRequest: { ...currentRequest, privateError: 'private',
            receipt: { ...currentRequest.receipt, evaluations: [{ income: 99 }] } } } }));
        expect(await loadQueueMonitorSnapshot()).toEqual({ ...snapshot(), currentRequest });
    });
    it.each([201, 202, 400, 500])('does not accept a snapshot under unexpected status %s', async status => {
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() }, { status })); await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it.each([['INVALID_INPUT', 400], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403], ['FEATURE_DISABLED', 503],
        ['SETUP_REQUIRED', 503], ['READ_UNAVAILABLE', 503]])('redacts known error %s at its exact status', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private raw SQL token=secret' } }, { status: Number(status) }));
        const error = await loadQueueMonitorSnapshot().catch(error => error);
        expect(error).toBeInstanceOf(QueueMonitorClientError); expect(error).toMatchObject({ code, status }); expect(error.message).not.toMatch(/private|raw SQL|token=secret/);
    });
    it.each([[400, { error: { code: 'FORBIDDEN', message: 'private' } }],
        [503, { error: { code: 'unrecognized', message: 'private' } }], [200, { error: { code: 'FORBIDDEN', message: 'private' } }],
        [200, { data: snapshot(), error: { code: 'FORBIDDEN', message: 'private' } }],
        [403, { data: snapshot(), error: { code: 'FORBIDDEN', message: 'private' } }],
        [503, { error: { code: 'READ_UNAVAILABLE' } }], [200, []], [200, null]])('rejects contradictory or unknown response status %s', async (status, body) => {
        fetchMock.mockResolvedValue(Response.json(body, { status: Number(status) }));
        await expect(loadQueueMonitorSnapshot()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('checks identity after malformed JSON and never exposes raw body content', async () => {
        fetchMock.mockResolvedValue(new Response('private HTML', { status: 503 })); const error = await loadQueueMonitorSnapshot().catch(error => error);
        expect(error).toMatchObject({ code: 'UNKNOWN_RESULT' }); expect(error.message).not.toContain('private'); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('never retries automatically or turns a failed read into a queue command', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private network'));
        const error = await loadQueueMonitorSnapshot().catch(error => error); expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
        expect(error.message).not.toContain('private'); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); expect(await loadQueueMonitorSnapshot(ADMIN)).toEqual(snapshot());
        expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET' && !('body' in options))).toBe(true);
    });
});
