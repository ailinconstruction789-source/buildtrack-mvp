import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, watchActor } = vi.hoisted(() => ({ getSession: vi.fn(), watchActor: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
vi.mock('../notificationClient', () => ({ watchNotificationActor: watchActor }));
import { SlaReceiptClientError, loadSlaReceiptContext, lookupSlaReceipt, slaReceiptApi } from '../slaReceiptClient';
import type { SlaProcessingInput } from '../slaProcessingContracts';

const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002', TASK = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T02:45:00.123456Z', INPUT = { requestId: REQUEST, taskId: TASK };
const actor = { userId: ADMIN, role: 'admin' };
const fetchMock = vi.fn();
function context() { return { actor: { ...actor }, processingEnabled: true }; }
function receipt() { return { actor: { ...actor }, ...INPUT, processedAt: AT, replayed: false,
    outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: AT, staffDueAt: null,
    notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null, withdrawnCount: 0 }; }
function lookup() { return { actor: { ...actor }, ...INPUT, found: true, receipt: receipt() }; }
function session(userId: unknown = ADMIN, token = 'caller-token') {
    return { data: { session: { user: { id: userId }, access_token: token } }, error: null };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const reads = [
    { name: 'context', invoke: () => loadSlaReceiptContext(), data: context },
    { name: 'lookup', invoke: () => lookupSlaReceipt(INPUT, ADMIN), data: lookup },
];
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());

describe('read-only receipt API and captured browser identity', () => {
    it('exports only reads and the privacy watcher without starting any request', () => {
        expect(slaReceiptApi).toEqual({ context: loadSlaReceiptContext, lookup: lookupSlaReceipt, watchActor });
        const invalidated = vi.fn(); slaReceiptApi.watchActor?.(ADMIN, invalidated);
        expect(watchActor).toHaveBeenCalledWith(ADMIN, invalidated); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('loads no-query context using GET and strips nonpublic values', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...context(), rawFlags: {}, income: 99, actor: { ...actor, email: 'private' } } }));
        expect(await loadSlaReceiptContext()).toEqual(context());
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/sales-crm/sla-receipts', {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        }); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('looks up normalized IDs with GET only and projects a historical receipt', async () => {
        const result = { ...lookup(), requestId: ADMIN, receipt: { ...receipt(), requestId: ADMIN } };
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, privateLedger: {}, receipt: { ...result.receipt, income: 99 } } }));
        expect(await lookupSlaReceipt({ requestId: ADMIN.toUpperCase(), taskId: TASK }, ADMIN)).toEqual(result);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/sales-crm/sla-receipts?requestId=${ADMIN}&taskId=${TASK}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        }); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('keeps absent receipt as an observation, never a no-commit claim or replay', async () => {
        const result = { actor, ...INPUT, found: false, receipt: null };
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, definitelyNotProcessed: true } }));
        expect(await lookupSlaReceipt(INPUT, ADMIN)).toEqual(result); expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].method).toBe('GET'); expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
    });
    it('copies IDs before awaiting the session so caller mutation cannot change a lookup', async () => {
        const pending = deferred<ReturnType<typeof session>>(); getSession.mockReturnValueOnce(pending.promise);
        fetchMock.mockResolvedValue(Response.json({ data: lookup() })); const mutable = { ...INPUT };
        const attempt = lookupSlaReceipt(mutable, ADMIN); mutable.requestId = OTHER; mutable.taskId = OTHER;
        pending.resolve(session()); expect(await attempt).toEqual(lookup());
        expect(fetchMock.mock.calls[0][0]).toBe(`/api/sales-crm/sla-receipts?requestId=${REQUEST}&taskId=${TASK}`);
    });
    it.each([null, [], {}, { requestId: REQUEST }, { ...INPUT, taskId: `${TASK}\n` }, { ...INPUT, requestId: 'bad' },
        { ...INPUT, ownerUserId: ADMIN }, { ...INPUT, replay: true }])('rejects malformed input %j before auth or network', async input => {
        await expect(lookupSlaReceipt(input as SlaProcessingInput, ADMIN)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([OTHER, '', `${ADMIN}\n`, undefined])('rejects mismatched expected actor %j before network', async expected => {
        await expect(lookupSlaReceipt(INPUT, expected as string)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', status: 409 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, 'bad', OTHER, `${ADMIN}\n`])('rejects invalid or changed session actor %j for lookup', async userId => {
        getSession.mockResolvedValue(session(userId));
        await expect(lookupSlaReceipt(INPUT, ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, 'bad', `${ADMIN}\n`])('rejects malformed session actor %j for context', async userId => {
        getSession.mockResolvedValue(session(userId));
        await expect(loadSlaReceiptContext()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    for (const read of reads) {
        it.each([{ data: { session: null }, error: null }, session(ADMIN, ''), { ...session(), error: { message: 'private' } }])(`${read.name}: rejects unavailable session before network %j`, async value => {
            getSession.mockResolvedValue(value); await expect(read.invoke()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
            expect(fetchMock).not.toHaveBeenCalled();
        });
        it(`${read.name}: redacts an initial session exception without requesting`, async () => {
            getSession.mockRejectedValueOnce(new Error('private token'));
            const error = await read.invoke().catch(error => error);
            expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE' }); expect(error.message).not.toContain('private');
            expect(error).not.toHaveProperty('definitelyNotProcessed'); expect(fetchMock).not.toHaveBeenCalled();
        });
    }
});

describe('identity checks during fetch, delayed JSON, errors and token refresh', () => {
    for (const read of reads) {
        it.each(['switch', 'signout'])(`${read.name}: withholds data on %s before JSON parsing`, async event => {
            getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(event === 'switch' ? session(OTHER) : { data: { session: null }, error: null });
            const json = vi.fn().mockResolvedValue({ data: read.data() }); fetchMock.mockResolvedValue({ ok: true, status: 200, json });
            await expect(read.invoke()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST', status: 409 }); expect(json).not.toHaveBeenCalled();
        });
        it.each(['resolve', 'reject'])(`${read.name}: checks account again when a delayed body will %s`, async outcome => {
            const body = deferred<unknown>(), entered = deferred<void>();
            fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => { entered.resolve(); return body.promise; } });
            const attempt = read.invoke(); const assertion = expect(attempt).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' });
            await entered.promise; getSession.mockResolvedValue(session(OTHER));
            if (outcome === 'resolve') body.resolve({ data: read.data() }); else body.reject(new Error('private malformed body'));
            await assertion; expect(fetchMock).toHaveBeenCalledTimes(1);
        });
        it(`${read.name}: checks identity when fetch fails`, async () => {
            getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER)); fetchMock.mockRejectedValue(new Error('private network'));
            await expect(read.invoke()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' }); expect(fetchMock).toHaveBeenCalledTimes(1);
        });
        it(`${read.name}: hides a server error from a changed account`, async () => {
            getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(OTHER));
            fetchMock.mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN', message: 'private' } }, { status: 403 }));
            await expect(read.invoke()).rejects.toMatchObject({ code: 'ACTOR_CHANGED_AFTER_REQUEST' });
        });
        it(`${read.name}: rejects unavailable post-body session without disclosing result`, async () => {
            getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session()).mockRejectedValueOnce(new Error('private session'));
            fetchMock.mockResolvedValue(Response.json({ data: read.data() }));
            const error = await read.invoke().catch(error => error); expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE' });
            expect(error.message).not.toContain('private'); expect(error).not.toHaveProperty('definitelyNotProcessed');
        });
        it(`${read.name}: allows a same-actor token refresh and retains captured bearer`, async () => {
            getSession.mockResolvedValueOnce(session(ADMIN.toUpperCase())).mockResolvedValue(session(ADMIN, 'refreshed-token'));
            fetchMock.mockResolvedValue(Response.json({ data: read.data() })); expect(await read.invoke()).toEqual(read.data());
            expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer caller-token');
        });
    }
});

describe('scope-bound projections and read failures never establish command rollback', () => {
    it.each([null, [], {}, { ...context(), actor: { userId: OTHER, role: 'admin' } },
        { ...context(), actor: { userId: ADMIN, role: 'sales' } }, { ...context(), processingEnabled: 'true' }])('rejects malformed context %j', async data => {
        fetchMock.mockResolvedValue(Response.json({ data })); await expect(loadSlaReceiptContext()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it.each([null, [], {}, { ...lookup(), actor: { userId: OTHER, role: 'admin' } }, { ...lookup(), requestId: OTHER },
        { ...lookup(), taskId: OTHER }, { ...lookup(), found: false }, { ...lookup(), receipt: null },
        { ...lookup(), receipt: { ...receipt(), actor: { userId: OTHER, role: 'admin' } } },
        { ...lookup(), receipt: { ...receipt(), requestId: OTHER } }, { ...lookup(), receipt: { ...receipt(), taskId: OTHER } },
        { ...lookup(), receipt: { ...receipt(), outcome: 'notified' } },
        { ...lookup(), receipt: { ...receipt(), processedAt: `${AT}\n` } }])('rejects malformed or wrong-scope lookup %j', async data => {
        fetchMock.mockResolvedValue(Response.json({ data })); const error = await lookupSlaReceipt(INPUT, ADMIN).catch(error => error);
        expect(error).toMatchObject({ code: 'UNKNOWN_RESULT' }); expect(error).not.toHaveProperty('definitelyNotProcessed'); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it.each([201, 202, 400, 500])('does not accept a receipt under unexpected HTTP status %s', async status => {
        fetchMock.mockResolvedValue(Response.json({ data: lookup() }, { status })); await expect(lookupSlaReceipt(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it.each([['INVALID_INPUT', 400], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403], ['FEATURE_DISABLED', 503],
        ['SETUP_REQUIRED', 503], ['READ_UNAVAILABLE', 503]])('redacts known error %s at its exact status', async (code, status) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'private raw SQL token=secret', definitelyNotProcessed: true } }, { status: Number(status) }));
        const error = await lookupSlaReceipt(INPUT, ADMIN).catch(error => error);
        expect(error).toBeInstanceOf(SlaReceiptClientError); expect(error).toMatchObject({ code, status });
        expect(error.message).not.toMatch(/private|raw SQL|token=secret/); expect(error).not.toHaveProperty('definitelyNotProcessed');
    });
    it.each([[400, { error: { code: 'FORBIDDEN', message: 'private' } }],
        [503, { error: { code: 'unrecognized', message: 'private' } }], [200, { error: { code: 'FORBIDDEN', message: 'private' } }],
        [200, { data: lookup(), error: { code: 'FORBIDDEN', message: 'private' } }],
        [403, { data: lookup(), error: { code: 'FORBIDDEN', message: 'private' } }],
        [503, { error: { code: 'READ_UNAVAILABLE' } }]])('rejects contradictory or unknown response status %s', async (status, body) => {
        fetchMock.mockResolvedValue(Response.json(body, { status: Number(status) }));
        await expect(lookupSlaReceipt(INPUT, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('checks identity after malformed JSON and never exposes raw body content', async () => {
        fetchMock.mockResolvedValue(new Response('private HTML', { status: 503 })); const error = await lookupSlaReceipt(INPUT, ADMIN).catch(error => error);
        expect(error).toMatchObject({ code: 'UNKNOWN_RESULT' }); expect(error.message).not.toContain('private');
        expect(error).not.toHaveProperty('definitelyNotProcessed'); expect(getSession).toHaveBeenCalledTimes(3);
    });
    it('never retries automatically or turns a failed read into a new command', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private network'));
        const error = await lookupSlaReceipt(INPUT, ADMIN).catch(error => error); expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
        expect(error).not.toHaveProperty('definitelyNotProcessed'); expect(error.message).not.toContain('private'); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: lookup() })); expect(await lookupSlaReceipt(INPUT, ADMIN)).toEqual(lookup());
        expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET' && !('body' in options))).toBe(true);
    });
});
