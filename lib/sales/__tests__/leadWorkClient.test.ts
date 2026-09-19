// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, directRpc, from } = vi.hoisted(() => ({ getSession: vi.fn(), directRpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession }, rpc: directRpc, from } }));
import { LeadWorkApiError, leadWorkApi } from '../leadWorkClient';
import type { LeadWorkInput } from '../leadWorkContracts';

const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const CUSTOMER = '00000000-0000-4000-8000-000000000001';
const ACTION = '00000000-0000-4000-8000-000000000002';
const ACTIVITY = '00000000-0000-4000-8000-000000000003';
const scope = { customerId: CUSTOMER, interestId: null };
const input: LeadWorkInput = { ...scope, command: 'set_next_action', requestId: ACTIVITY, expectedActionId: null,
    nextAction: { action: 'ติดตาม', dueAt: '2026-09-16T14:00:00.123456+07:00' }, reason: 'ลูกค้าขอนัดใหม่' };
const result = { nextActionId: ACTION, activityId: null, replayed: false };
function snapshot() {
    return { actor: { userId: USER, role: 'sales' }, scope, customer: { id: CUSTOMER, name: 'ลูกค้า', phone: null, leadCreatedAt: null },
        projectName: null, owner: { userId: USER, displayName: null, active: true }, scopeClosed: false, lifecycleRevision: ACTION, canWrite: true,
        asOf: '2026-09-16T12:00:00.979649+07:00', currentAction: null, actions: [], activities: [],
        history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } };
}
const fetchMock = vi.fn();
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValue({ data: { session: { user: { id: USER }, access_token: 'caller-token' } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); expect(directRpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); });

describe('lead work browser read transport', () => {
    it('requests only the app API using a session bearer, no cache/cookies, and projects validated data', async () => {
        const data = snapshot(); fetchMock.mockResolvedValue(Response.json({ data: { ...data, privateDump: 'secret' } }));
        expect(await leadWorkApi.read(scope)).toEqual(data);
        expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/lead-work?customerId=${CUSTOMER}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        });
    });
    it('requires a session and does not send a network request when absent', async () => {
        getSession.mockResolvedValue({ data: { session: null }, error: null });
        await expect(leadWorkApi.read(scope)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('binds results to requested scope and rejects malformed or ambiguous responses', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(), scope: { ...scope, customerId: ACTION } } }));
        await expect(leadWorkApi.read(scope)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
        fetchMock.mockResolvedValue(Response.json({ data: snapshot(), error: { code: 'FORBIDDEN', message: 'bad' } }));
        await expect(leadWorkApi.read(scope)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('validates scope before asking for a session', async () => {
        await expect(leadWorkApi.read({ customerId: 'invalid', interestId: null })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('does not use write-uncertainty wording for a failed read', async () => {
        fetchMock.mockRejectedValue(new Error('private failure'));
        const error = await leadWorkApi.read(scope).catch(value => value);
        expect(error.code).toBe('NETWORK_ERROR'); expect(error.message).not.toContain('รหัสคำขอ');
    });
});

describe('lead work browser write intent and duplicate safety', () => {
    it('preserves the request ID and sends only normalized input to the app, never expectedActorId', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, secret: 'hidden' } }, { status: 201 }));
        expect(await leadWorkApi.save(input, USER)).toEqual(result);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [path, options] = fetchMock.mock.calls[0];
        expect(path).toBe('/api/sales-crm/lead-work'); expect(options.credentials).toBe('omit'); expect(options.cache).toBe('no-store');
        expect(JSON.parse(options.body)).toEqual(input); expect(options.headers.Authorization).toBe('Bearer caller-token');
    });
    it.each([ACTION, null, undefined, `${USER}\n`])('refuses changed/missing session actor %j before POST', async actor => {
        getSession.mockResolvedValue({ data: { session: { user: actor === undefined ? undefined : { id: actor }, access_token: 'other-token' } }, error: null });
        await expect(leadWorkApi.save(input, USER)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('uses actor and token from the same captured session and never authorizes from metadata', async () => {
        getSession.mockResolvedValue({ data: { session: { user: { id: ACTION, user_metadata: { role: 'admin' } }, access_token: 'new-admin-token' } }, error: null });
        await expect(leadWorkApi.save(input, USER)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('requires a valid expected actor and accepts equivalent UUID casing', async () => {
        await expect(leadWorkApi.save(input, '')).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue(Response.json({ data: result }, { status: 201 }));
        await expect(leadWorkApi.save(input, USER.toUpperCase())).resolves.toEqual(result);
    });
    it('rejects invalid input before auth/network', async () => {
        await expect(leadWorkApi.save({ ...input, reason: '' }, USER)).rejects.toMatchObject({ code: 'INVALID_INPUT', definitelyNotSaved: true });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('does not retry network uncertainty automatically and reuses identity on explicit retry', async () => {
        fetchMock.mockRejectedValueOnce(new Error('connection lost'));
        await expect(leadWorkApi.save(input, USER)).rejects.toMatchObject({ code: 'NETWORK_ERROR', definitelyNotSaved: false });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, replayed: true } }));
        await expect(leadWorkApi.save(input, USER)).resolves.toMatchObject({ replayed: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    });
    it.each([
        ['STALE_ACTION', 409, true], ['ACTOR_CHANGED', 409, true], ['FEATURE_DISABLED', 503, true], ['SETUP_REQUIRED', 503, true],
        ['INVALID_INPUT', 400, true], ['FORBIDDEN', 403, true], ['IDEMPOTENCY_CONFLICT', 409, false], ['SERVICE_UNAVAILABLE', 503, false],
        ['UNKNOWN_PROXY', 400, false], ['INVALID_INPUT', 503, false], ['FEATURE_DISABLED', 409, false], ['toString', 409, false], ['constructor', 400, false],
    ])('classifies only the exact error allowlist %s/%i', async (code, status, definitive) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'ข้อความจากระบบ' } }, { status: Number(status) }));
        const error = await leadWorkApi.save(input, USER).catch(value => value);
        expect(error).toBeInstanceOf(LeadWorkApiError); expect(error.definitelyNotSaved).toBe(definitive);
    });
    it.each([
        [201, null], [201, {}], [201, { ...result, nextActionId: `${ACTION}\n` }], [201, { ...result, activityId: ACTIVITY }],
        [200, result], [201, { ...result, replayed: true }], [202, result],
    ])('treats malformed/incompatible save result %j as uncertain', async (status, data) => {
        fetchMock.mockResolvedValue(Response.json({ data }, { status: Number(status) }));
        await expect(leadWorkApi.save(input, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it('requires a record_attempt activity ID in a successful result', async () => {
        const attempt: LeadWorkInput = { ...input, command: 'record_attempt', attempt: { action: 'โทรแล้ว', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-16T09:00:00Z' } };
        fetchMock.mockResolvedValue(Response.json({ data: result }, { status: 201 }));
        await expect(leadWorkApi.save(attempt, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, activityId: ACTIVITY } }, { status: 201 }));
        await expect(leadWorkApi.save(attempt, USER)).resolves.toMatchObject({ activityId: ACTIVITY });
    });
    it('never treats malformed JSON or an error envelope in HTTP200 as definitely unsaved', async () => {
        fetchMock.mockResolvedValue(new Response('<html>gateway failure</html>', { status: 502 }));
        await expect(leadWorkApi.save(input, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
        fetchMock.mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN', message: 'bad gateway' } }));
        await expect(leadWorkApi.save(input, USER)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
});
