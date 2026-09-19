// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, directRpc, from } = vi.hoisted(() => ({ getSession: vi.fn(), directRpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession }, rpc: directRpc, from } }));
import { leadLifecycleApi, LeadLifecycleApiError } from '../leadLifecycleClient';
import type { LeadLifecycleInput } from '../leadLifecycleContracts';
import type { LeadWorkScope } from '../leadWorkReadContracts';

const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const CUSTOMER = '00000000-0000-4000-8000-000000000001';
const ACTION = '00000000-0000-4000-8000-000000000002';
const REQUEST = '00000000-0000-4000-8000-000000000003';
const REVISION = '00000000-0000-4000-8000-000000000004';
const NEXT_REVISION = '00000000-0000-4000-8000-000000000005';
const TARGET = '00000000-0000-4000-8000-000000000006';
const scope = { customerId: CUSTOMER, interestId: null };
const input: LeadLifecycleInput = { ...scope, requestId: REQUEST, command: 'close_lost', expectedRevision: REVISION, expectedActionId: ACTION, reason: 'ลูกค้าไม่สนใจแล้ว' };
const reassign: LeadLifecycleInput = { ...input, command: 'reassign_owner', newOwnerUserId: TARGET };
const result = { revision: NEXT_REVISION, nextActionId: null, replayed: false };
function context(interestId: string | null = null) {
    return { work: { actor: { userId: USER, role: 'admin' }, scope: { ...scope, interestId },
        customer: { id: CUSTOMER, name: 'ลูกค้า', phone: null, leadCreatedAt: null },
        projectName: interestId === null ? null : 'โครงการ A', owner: { userId: USER, displayName: null, active: true },
        scopeClosed: false, lifecycleRevision: REVISION, canWrite: true, asOf: '2026-09-16T12:00:00.979649+07:00',
        currentAction: null, actions: [], activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } },
    candidates: [{ userId: TARGET, displayName: null }], candidatesTruncated: false, canReassign: true, canClose: true,
    blockers: { hasBookingHistory: false, hasOpenInterests: false }, impact: { openSlaCount: 2, pendingNotificationCount: 5 } };
}
const fetchMock = vi.fn();
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValue({ data: { session: { user: { id: USER }, access_token: 'caller-token' } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); expect(directRpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); });

describe('lifecycle browser context transport', () => {
    it('uses only the app API, session bearer, no cookies/cache and projected data', async () => {
        const data = context(); fetchMock.mockResolvedValue(Response.json({ data: { ...data, privateDump: 'secret' } }));
        expect(await leadLifecycleApi.read(scope)).toEqual(data);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/sales-crm/lifecycle?customerId=${CUSTOMER}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        });
        expect(getSession).toHaveBeenCalledTimes(1);
    });
    it('adds the exact interest to project scope and binds the response to it', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: context(ACTION) }));
        expect((await leadLifecycleApi.read({ ...scope, interestId: ACTION })).work.scope.interestId).toBe(ACTION);
        expect(fetchMock.mock.calls[0][0]).toBe(`/api/sales-crm/lifecycle?customerId=${CUSTOMER}&interestId=${ACTION}`);
        fetchMock.mockResolvedValue(Response.json({ data: context() }));
        await expect(leadLifecycleApi.read({ ...scope, interestId: ACTION })).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it.each([null, {}, { customerId: CUSTOMER }, { ...scope, customerId: 'bad' }, { ...scope, interestId: '' }, { ...scope, interestId: `${ACTION}\n` }])('rejects bad scope %j before auth/network', async value => {
        await expect(leadLifecycleApi.read(value as LeadWorkScope)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('requires a session without directly querying Supabase data', async () => {
        getSession.mockResolvedValue({ data: { session: null }, error: null });
        await expect(leadLifecycleApi.read(scope)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects malformed rights/counts/scope/read-v1 snapshots instead of displaying them', async () => {
        const data = context();
        for (const invalid of [{ ...data, canClose: false }, { ...data, impact: { ...data.impact, openSlaCount: -1 } },
            { ...data, work: { ...data.work, lifecycleRevision: undefined } },
            { ...data, work: { ...data.work, customer: { ...data.work.customer, id: TARGET } } }]) {
            fetchMock.mockResolvedValue(Response.json({ data: invalid }));
            await expect(leadLifecycleApi.read(scope)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
        }
    });
    it.each([201, 202, 500])('requires status 200 for a successful context, not %s', async status => {
        fetchMock.mockResolvedValue(Response.json({ data: context() }, { status }));
        await expect(leadLifecycleApi.read(scope)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('uses read-only failure wording without claiming uncertain writes', async () => {
        fetchMock.mockRejectedValue(new Error('private failure'));
        let error = await leadLifecycleApi.read(scope).catch(value => value);
        expect(error.code).toBe('NETWORK_ERROR'); expect(error.message).not.toMatch(/รหัสคำขอ|ผลบันทึก|private/);
        fetchMock.mockResolvedValue(Response.json({ data: null }));
        error = await leadLifecycleApi.read(scope).catch(value => value);
        expect(error.code).toBe('UNKNOWN_RESULT'); expect(error.message).not.toContain('รหัสคำขอ');
    });
});

describe('lifecycle write intent and uncertain-result safety', () => {
    it('sends only normalized command data, preserving both concurrency tokens and request ID', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, privateDump: 'secret' } }, { status: 201 }));
        expect(await leadLifecycleApi.save({ ...input, customerId: CUSTOMER.toUpperCase(), reason: ` ${input.reason} ` }, USER)).toEqual(result);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [path, options] = fetchMock.mock.calls[0];
        expect(path).toBe('/api/sales-crm/lifecycle'); expect(options.method).toBe('POST');
        expect(options.cache).toBe('no-store'); expect(options.credentials).toBe('omit');
        expect(options.headers).toEqual({ Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body)).toEqual(input); expect(options.body).not.toContain('expectedActorId');
    });
    it.each([TARGET, null, undefined, `${USER}\n`])('blocks changed/missing current actor %j before POST', async actor => {
        getSession.mockResolvedValue({ data: { session: { user: actor === undefined ? undefined : { id: actor, app_metadata: { role: 'admin' } }, access_token: 'new-token' } }, error: null });
        await expect(leadLifecycleApi.save(input, USER)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('binds to the actor loaded in the context even if the account changes on the same page', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: context() }));
        const loaded = await leadLifecycleApi.read(scope);
        getSession.mockResolvedValue({ data: { session: { user: { id: TARGET, user_metadata: { role: 'admin' } }, access_token: 'new-admin-token' } }, error: null });
        await expect(leadLifecycleApi.save(input, loaded.work.actor.userId)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
        expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });
    it('requires an explicit expected actor and accepts UUID casing without a second session lookup', async () => {
        await expect(leadLifecycleApi.save(input, '')).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
        vi.clearAllMocks();
        fetchMock.mockResolvedValue(Response.json({ data: result }, { status: 201 }));
        expect(await leadLifecycleApi.save(input, USER.toUpperCase())).toEqual(result); expect(getSession).toHaveBeenCalledTimes(1);
    });
    it.each([{ ...input, reason: '' }, { ...input, expectedRevision: null }, { ...input, ownerUserId: TARGET }, { ...input, dueAt: '2026-09-16' }])('rejects malformed/injected input %j before session lookup', async value => {
        await expect(leadLifecycleApi.save(value as LeadLifecycleInput, USER)).rejects.toMatchObject({ code: 'INVALID_INPUT', definitelyNotSaved: true });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('does not automatically retry network uncertainty and reuses the exact command on explicit retry', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private connection lost'));
        await expect(leadLifecycleApi.save(input, USER)).rejects.toMatchObject({ code: 'NETWORK_ERROR', definitelyNotSaved: false });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, replayed: true } }));
        await expect(leadLifecycleApi.save(input, USER)).resolves.toMatchObject({ replayed: true });
        expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    });
    it.each([
        ['INVALID_INPUT', 400, true], ['UNAUTHENTICATED', 401, true], ['FORBIDDEN', 403, true], ['NOT_FOUND', 404, true],
        ['STALE_SCOPE', 409, true], ['STALE_ACTION', 409, true], ['SCOPE_CLOSED', 409, true], ['INACTIVE_TARGET', 409, true],
        ['BOOKING_HISTORY_EXISTS', 409, true], ['OPEN_INTERESTS', 409, true], ['UNCHANGED_OWNER', 409, true], ['ACTOR_CHANGED', 409, true],
        ['PAYLOAD_TOO_LARGE', 413, true], ['UNSUPPORTED_MEDIA_TYPE', 415, true], ['SETUP_REQUIRED', 503, true], ['FEATURE_DISABLED', 503, true],
        ['IDEMPOTENCY_CONFLICT', 409, false], ['SERVICE_UNAVAILABLE', 503, false], ['UNKNOWN_PROXY', 400, false],
        ['INVALID_INPUT', 503, false], ['FEATURE_DISABLED', 409, false], ['toString', 409, false], ['constructor', 400, false],
    ])('classifies only exact error code/status %s/%i as definitive=%j', async (code, status, definitive) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'ข้อความจากระบบ' } }, { status: Number(status) }));
        const error = await leadLifecycleApi.save(input, USER).catch(value => value);
        expect(error).toBeInstanceOf(LeadLifecycleApiError); expect(error.definitelyNotSaved).toBe(definitive);
    });
    it.each([[201, null], [201, {}], [201, { ...result, revision: `${REVISION}\n` }], [201, { ...result, nextActionId: ACTION }],
        [200, result], [201, { ...result, replayed: true }], [202, result]])('treats incompatible successful reply status=%j data=%j as uncertain', async (status, data) => {
        fetchMock.mockResolvedValue(Response.json({ data }, { status: Number(status) }));
        await expect(leadLifecycleApi.save(input, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it('checks action-presence and new-action identity for reassignment results', async () => {
        for (const nextActionId of [null, ACTION]) {
            fetchMock.mockResolvedValue(Response.json({ data: { ...result, nextActionId } }, { status: 201 }));
            await expect(leadLifecycleApi.save(reassign, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
        }
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, nextActionId: TARGET } }, { status: 201 }));
        await expect(leadLifecycleApi.save(reassign, USER)).resolves.toMatchObject({ nextActionId: TARGET });
        await expect(leadLifecycleApi.save({ ...reassign, expectedActionId: null }, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
        fetchMock.mockResolvedValue(Response.json({ data: result }, { status: 201 }));
        await expect(leadLifecycleApi.save({ ...reassign, expectedActionId: null }, USER)).resolves.toEqual(result);
    });
    it.each([
        { status: 200, body: { error: { code: 'FORBIDDEN', message: 'bad' } } },
        { status: 403, body: { data: result, error: { code: 'FORBIDDEN', message: 'bad' } } },
        { status: 503, body: { error: { code: '', message: 'bad' } } },
        { status: 400, body: [] }, { status: 400, body: null },
    ])('does not turn malformed or contradictory envelopes %j into definite rejections', async ({ status, body }) => {
        fetchMock.mockResolvedValue(Response.json(body, { status }));
        await expect(leadLifecycleApi.save(input, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it('treats non-JSON and session transport throws conservatively without leaking diagnostics', async () => {
        fetchMock.mockResolvedValue(new Response('private upstream html', { status: 503 }));
        let error = await leadLifecycleApi.save(input, USER).catch(value => value);
        expect(error).toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false }); expect(error.message).not.toContain('private');
        vi.clearAllMocks(); getSession.mockRejectedValue(new Error('private token'));
        error = await leadLifecycleApi.save(input, USER).catch(value => value);
        expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotSaved: false }); expect(error.message).not.toContain('private'); expect(fetchMock).not.toHaveBeenCalled();
    });
});
