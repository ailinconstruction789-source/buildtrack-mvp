import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, watchActor } = vi.hoisted(() => ({ getSession: vi.fn(), watchActor: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
vi.mock('../notificationClient', () => ({ watchNotificationActor: watchActor }));
import { SlaProcessingClientError, processFirstContact, slaProcessingApi } from '../slaProcessingClient';
import type { SlaProcessingInput } from '../slaProcessingContracts';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002', TASK = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T02:45:00.123456Z', DUE = '2026-09-17T03:00:00.123456Z';
const INPUT = { requestId: REQUEST, taskId: TASK };
const fetchMock = vi.fn();
function receipt() { return { actor: { userId: ADMIN, role: 'admin' }, ...INPUT, processedAt: AT, replayed: false,
    outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: DUE, staffDueAt: null, notificationId: null, notificationType: null,
    completedByActivityId: null, completedAt: null, withdrawnCount: 0 }; }
function session(userId: unknown = ADMIN, token = 'caller-token') { return { data: { session: { user: { id: userId }, access_token: token } }, error: null }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());

describe('explicit command-only processing and capturedbrowseractor', () => {
    it('exports process and synchronous privacywatcher only, with no automatic request', () => {
        expect(slaProcessingApi).toEqual({ process: processFirstContact, watchActor }); const invalidated = vi.fn();
        slaProcessingApi.watchActor?.(ADMIN, invalidated); expect(watchActor).toHaveBeenCalledWith(ADMIN, invalidated); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('sends only normalized request/task with capturedbearer and projects receipt', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...receipt(), requestId: ADMIN, rawCalendar: {}, privateIncome: 99 } }));
        expect(await processFirstContact({ requestId: ADMIN.toUpperCase(), taskId: TASK }, ADMIN)).toEqual({ ...receipt(), requestId: ADMIN });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/sales-crm/sla-process', {
            method: 'POST', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: ADMIN, taskId: TASK }),
        }); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('copies input before asyncsession so caller mutation cannot change a queuedcommand', async () => {
        const pendingSession = deferred<ReturnType<typeof session>>(); getSession.mockReturnValueOnce(pendingSession.promise);
        fetchMock.mockResolvedValue(Response.json({ data: receipt() })); const mutable = { ...INPUT };
        const attempt = processFirstContact(mutable, ADMIN); mutable.taskId = OTHER; mutable.requestId = OTHER;
        pendingSession.resolve(session()); expect(await attempt).toEqual(receipt()); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(INPUT);
    });
    it.each([null, [], {}, { taskId: TASK }, { ...INPUT, requestId: 'bad' }, { ...INPUT, taskId: `${TASK}\n` },
        { ...INPUT, ownerUserId: ADMIN }, { ...INPUT, staffDueAt: DUE }, { ...INPUT, preview: {} }])('rejects invalid/injected command%j before auth/network', async value => {
        await expect(processFirstContact(value as SlaProcessingInput, ADMIN)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400, definitelyNotProcessed: true });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([OTHER, '', `${ADMIN}\n`, undefined])('rejects mismatched loadedactor%j before request', async expected => {
        await expect(processFirstContact(INPUT, expected as string)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', status: 409, definitelyNotProcessed: true }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, undefined, 'bad', OTHER, `${ADMIN}\n`])('rejects invalid/changed sessionactor%j before request', async userId => {
        getSession.mockResolvedValue({ data: { session: { user: { id: userId }, access_token: 'token' } }, error: null });
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotProcessed: true }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([{ data: { session: null }, error: null }, session(ADMIN, ''), { ...session(), error: { message: 'private' } }])('rejects invalidsession%j before request', async value => {
        getSession.mockResolvedValue(value); await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', definitelyNotProcessed: true }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('distinguishes initial sessionfailure from a post-request sessionfailure', async () => {
        getSession.mockRejectedValueOnce(new Error('private session'));
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotProcessed: true }); expect(fetchMock).not.toHaveBeenCalled();
        getSession.mockResolvedValueOnce(session()).mockRejectedValueOnce(new Error('private session'));
        fetchMock.mockResolvedValue(Response.json({ data: receipt() }));
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotProcessed: false }); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
describe('identity checks across every post-request await', () => {
    it.each(['switch', 'signout'])('withholds receipt when%s before body parsing', async event => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(event === 'switch' ? session(OTHER) : { data: { session: null }, error: null });
        const json = vi.fn().mockResolvedValue({ data: receipt() }); fetchMock.mockResolvedValue({ ok: true, status: 200, json });
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', definitelyNotProcessed: false }); expect(json).not.toHaveBeenCalled();
    });
    it.each(['resolve', 'reject'])('rechecks identity after body%s duringaccountswtich', async outcome => {
        const body = deferred<unknown>(), entered = deferred<void>();
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => { entered.resolve(); return body.promise; } });
        const attempt = processFirstContact(INPUT, ADMIN); const assertion = expect(attempt).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', definitelyNotProcessed: false });
        await entered.promise; getSession.mockResolvedValue(session(OTHER));
        if (outcome === 'resolve') body.resolve({ data: receipt() }); else body.reject(new Error('private malformedbody'));
        await assertion; expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('checks identity on networkfailure and does not claim rollback', async () => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER)); fetchMock.mockRejectedValue(new Error('private network'));
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', definitelyNotProcessed: false });
    });
    it('does not expose definitive serverrejection to a changed actor', async () => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER));
        fetchMock.mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN', message: 'private', definitelyNotProcessed: true } }, { status: 403 }));
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', definitelyNotProcessed: false });
    });
    it('allows tokenrefresh for same actor and preserves captured bearer', async () => {
        getSession.mockResolvedValueOnce(session(ADMIN.toUpperCase())).mockResolvedValue(session(ADMIN, 'refreshed-token'));
        fetchMock.mockResolvedValue(Response.json({ data: receipt() })); expect(await processFirstContact(INPUT, ADMIN.toUpperCase())).toEqual(receipt());
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer caller-token');
    });
    it('keeps a thrown post-body sessioncheck uncertain and hides returned private receipt', async () => {
        getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session()).mockRejectedValueOnce(new Error('private session'));
        fetchMock.mockResolvedValue(Response.json({ data: receipt() })); await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotProcessed: false });
    });
});
describe('same-request retry and receipt scope', () => {
    it('never retries a networkfailure automatically and explicit retry retains exactidentity', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private lostresponse'));
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'NETWORK_ERROR', definitelyNotProcessed: false }); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: { ...receipt(), replayed: true } }));
        expect(await processFirstContact(INPUT, ADMIN)).toEqual({ ...receipt(), replayed: true });
        expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    });
    it.each([null, [], {}, { ...receipt(), actor: { userId: OTHER, role: 'admin' } }, { ...receipt(), actor: { userId: ADMIN, role: 'sales' } },
        { ...receipt(), requestId: OTHER }, { ...receipt(), taskId: OTHER }, { ...receipt(), processedAt: `${AT}\n` },
        { ...receipt(), outcome: 'notified' }, { ...receipt(), replayed: 'true' }])('keeps invalid/wrongscope success%j uncertain', async data => {
        fetchMock.mockResolvedValue(Response.json({ data })); await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotProcessed: false }); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it.each([201, 202, 400, 500])('rejects receipt with unexpectedHTTPstatus%s as uncertain', async status => {
        fetchMock.mockResolvedValue(Response.json({ data: receipt() }, { status })); await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotProcessed: false });
    });
    it('a later definitiveabort describes only laterattempt, not previous unknown outcome', async () => {
        fetchMock.mockRejectedValueOnce(new Error('lostresponse')).mockResolvedValueOnce(Response.json({ error: { code: 'FEATURE_DISABLED', message: 'private', definitelyNotProcessed: true } }, { status: 503 }));
        const previous = await processFirstContact(INPUT, ADMIN).catch(error => error); const later = await processFirstContact(INPUT, ADMIN).catch(error => error);
        expect(previous.definitelyNotProcessed).toBe(false); expect(later.definitelyNotProcessed).toBe(true);
        expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    });
});
describe('explicit safe abort proof and redacted errors', () => {
    it.each([['INVALID_INPUT', 400], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403], ['NOT_AVAILABLE', 404], ['IDEMPOTENCY_CONFLICT', 409],
        ['PAYLOAD_TOO_LARGE', 413], ['UNSUPPORTED_MEDIA_TYPE', 415], ['FEATURE_DISABLED', 503], ['SETUP_REQUIRED', 503], ['PRECHECK_UNAVAILABLE', 503]])('accepts confirmed%s only at exactstatus', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private raw SQL token=secret', definitelyNotProcessed: true } }, { status: Number(status) }));
        const error = await processFirstContact(INPUT, ADMIN).catch(error => error); expect(error).toBeInstanceOf(SlaProcessingClientError);
        expect(error).toMatchObject({ code, status, definitelyNotProcessed: true }); expect(error.message).not.toMatch(/private|raw SQL|token=secret/);
    });
    it.each([undefined, false, 'true', 1])('rejects absent/contradictoryphaseproof%j as uncertain', async definitelyNotProcessed => {
        fetchMock.mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN', message: 'private', definitelyNotProcessed } }, { status: 403 }));
        await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotProcessed: false });
    });
    it('accepts explicit unknown-result response but never upgrades it to rollback', async () => {
        for (const definitelyNotProcessed of [false, true]) {
            fetchMock.mockResolvedValue(Response.json({ error: { code: 'UNKNOWN_RESULT', message: 'private', definitelyNotProcessed } }, { status: 503 }));
            await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotProcessed: false });
        }
    });
    it.each([[400, { error: { code: 'FORBIDDEN', message: 'private', definitelyNotProcessed: true } }],
        [500, { error: { code: 'unrecognized', message: 'private', definitelyNotProcessed: true } }],
        [200, { error: { code: 'FORBIDDEN', message: 'private', definitelyNotProcessed: true } }],
        [200, { data: receipt(), error: { code: 'FORBIDDEN', message: 'private', definitelyNotProcessed: true } }]])('keeps contradictoryenvelope/status%s uncertain', async (status, body) => {
        fetchMock.mockResolvedValue(Response.json(body, { status: Number(status) })); await expect(processFirstContact(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotProcessed: false });
    });
    it('sanitizes malformedJSON and checks account on its failure path', async () => {
        fetchMock.mockResolvedValue(new Response('private html', { status: 503 })); const error = await processFirstContact(INPUT, ADMIN).catch(error => error);
        expect(error).toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotProcessed: false }); expect(error.message).not.toContain('private'); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('constructor cannot claim rollback for unknowncode/status even with explicittrue', () => {
        expect(new SlaProcessingClientError('UNKNOWN_RESULT', 'unknown', 503, true).definitelyNotProcessed).toBe(false);
        expect(new SlaProcessingClientError('FORBIDDEN', 'forbidden', 500, true).definitelyNotProcessed).toBe(false);
        expect(new SlaProcessingClientError('FORBIDDEN', 'forbidden', 403).definitelyNotProcessed).toBe(false);
    });
});
