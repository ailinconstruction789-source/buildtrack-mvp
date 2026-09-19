// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, directRpc, from } = vi.hoisted(() => ({ getSession: vi.fn(), directRpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession }, rpc: directRpc, from } }));
import { workScheduleApi, WorkScheduleApiError } from '../workScheduleClient';
import type { WorkScheduleInput } from '../workScheduleContracts';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const SALES = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002';
const CALENDAR = '00000000-0000-4000-8000-000000000003';
const VERSION = '00000000-0000-4000-8000-000000000004';
const NEXT = '00000000-0000-4000-8000-000000000005';
const input: WorkScheduleInput = { requestId: REQUEST, salesUserId: SALES, expectedVersion: VERSION,
    coverage: { startsAt: '2026-09-16T00:00:00.123456+07:00', endsAt: '2026-09-17T00:00:00.123456+07:00' },
    periods: [], confirmedComplete: true, reason: 'วันหยุดที่ยืนยันครบแล้ว' };
const result = { calendarId: CALENDAR, version: NEXT, salesUserId: SALES, replayed: false };
function snapshot(selected: string | null = null) {
    return { actor: { userId: ADMIN, role: 'admin' }, asOf: '2026-09-16T12:00:00.979649+07:00',
        sales: [{ userId: SALES, displayName: null }], salesHasMore: false, selectedSalesUserId: selected, calendar: null };
}
const fetchMock = vi.fn();
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValue({ data: { session: { user: { id: ADMIN }, access_token: 'caller-token' } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); expect(directRpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); });

describe('schedule browser read transport', () => {
    it.each([null, SALES])('reads selection %j only through app bearer API without cookies/cache', async selected => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(selected), privateDump: 'hidden' } }));
        expect(await workScheduleApi.read(selected)).toEqual(snapshot(selected));
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/sales-crm/work-schedule${selected === null ? '' : `?salesUserId=${SALES}`}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
        });
    });
    it.each([undefined, '', 'bad', `${SALES}\n`])('rejects malformed selection %j before auth/network', async selected => {
        await expect(workScheduleApi.read(selected as string)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('requires a session before fetching any schedule', async () => {
        getSession.mockResolvedValue({ data: { session: null }, error: null });
        await expect(workScheduleApi.read(null)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { ...snapshot(), selectedSalesUserId: SALES }, { ...snapshot(), actor: { userId: ADMIN, role: 'owner' } }])('rejects unbound/malformed returned snapshot %j', async data => {
        fetchMock.mockResolvedValue(Response.json({ data }));
        await expect(workScheduleApi.read(null)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it.each([201, 202, 500])('rejects context returned with status %s instead of200', async status => {
        fetchMock.mockResolvedValue(Response.json({ data: snapshot() }, { status })); await expect(workScheduleApi.read(null)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    });
    it('uses read-only wording for transport and projection failures', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private failure'));
        let error = await workScheduleApi.read(null).catch(value => value);
        expect(error.code).toBe('NETWORK_ERROR'); expect(error.message).not.toMatch(/รหัสคำขอ|ผลบันทึก|private/);
        fetchMock.mockResolvedValue(Response.json({ data: null })); error = await workScheduleApi.read(null).catch(value => value);
        expect(error.code).toBe('UNKNOWN_RESULT'); expect(error.message).not.toContain('รหัสคำขอ');
    });
});

describe('schedule browser write intent and replay safety', () => {
    it('preserves target/version/request and only sends normalized command payload', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, privateDump: 'hidden' } }, { status: 201 }));
        expect(await workScheduleApi.save({ ...input, reason: ` ${input.reason} ` }, ADMIN)).toEqual(result);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/sales-crm/work-schedule'); expect(options.method).toBe('POST');
        expect(options.cache).toBe('no-store'); expect(options.credentials).toBe('omit');
        expect(options.headers).toEqual({ Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body)).toEqual(input); expect(options.body).not.toContain('expectedActorId');
    });
    it.each([SALES, null, undefined, `${ADMIN}\n`])('blocks changed/missing captured session user %j before POST', async userId => {
        getSession.mockResolvedValue({ data: { session: { user: userId === undefined ? undefined : { id: userId, app_metadata: { role: 'admin' } }, access_token: 'new-token' } }, error: null });
        await expect(workScheduleApi.save(input, ADMIN)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('binds loaded actor to save even when the logged-in Admin changes on the same page', async () => {
        fetchMock.mockResolvedValue(Response.json({ data: snapshot(SALES) })); const loaded = await workScheduleApi.read(SALES);
        getSession.mockResolvedValue({ data: { session: { user: { id: SALES, user_metadata: { role: 'admin' } }, access_token: 'other-admin-token' } }, error: null });
        await expect(workScheduleApi.save(input, loaded.actor.userId)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('requires expected actor and accepts normalized UUID casing with exactly one session read', async () => {
        await expect(workScheduleApi.save(input, '')).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
        vi.clearAllMocks(); fetchMock.mockResolvedValue(Response.json({ data: result }, { status: 201 }));
        expect(await workScheduleApi.save(input, ADMIN.toUpperCase())).toEqual(result); expect(getSession).toHaveBeenCalledTimes(1);
    });
    it.each([{ ...input, reason: '' }, { ...input, confirmedComplete: false }, { ...input, expectedVersion: '' }, { ...input, ownerUserId: ADMIN }])('rejects invalid/injected payload %j before auth/network', async value => {
        await expect(workScheduleApi.save(value as WorkScheduleInput, ADMIN)).rejects.toMatchObject({ code: 'INVALID_INPUT', definitelyNotSaved: true });
        expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('retains exact request across explicit retry and never retries uncertainty automatically', async () => {
        fetchMock.mockRejectedValueOnce(new Error('private lost connection'));
        await expect(workScheduleApi.save(input, ADMIN)).rejects.toMatchObject({ code: 'NETWORK_ERROR', definitelyNotSaved: false }); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValue(Response.json({ data: { ...result, replayed: true } }));
        await expect(workScheduleApi.save(input, ADMIN)).resolves.toMatchObject({ replayed: true });
        expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    });
    it.each([['INVALID_INPUT', 400, true], ['UNAUTHENTICATED', 401, true], ['FORBIDDEN', 403, true], ['NOT_FOUND', 404, true],
        ['STALE_VERSION', 409, true], ['INACTIVE_TARGET', 409, true], ['ACTOR_CHANGED', 409, true], ['PAYLOAD_TOO_LARGE', 413, true],
        ['UNSUPPORTED_MEDIA_TYPE', 415, true], ['SETUP_REQUIRED', 503, true], ['FEATURE_DISABLED', 503, true],
        ['IDEMPOTENCY_CONFLICT', 409, false], ['SERVICE_UNAVAILABLE', 503, false], ['CONFLICT', 409, false], ['UNKNOWN_PROXY', 400, false],
        ['INVALID_INPUT', 503, false], ['FEATURE_DISABLED', 409, false], ['toString', 409, false], ['constructor', 400, false]])('classifies exact code/status %s/%i as definitive=%j', async (code, status, definitive) => {
        fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'ข้อความจากระบบ' } }, { status: Number(status) }));
        const error = await workScheduleApi.save(input, ADMIN).catch(value => value);
        expect(error).toBeInstanceOf(WorkScheduleApiError); expect(error.definitelyNotSaved).toBe(definitive);
    });
    it.each([[201, null], [201, {}], [201, { ...result, version: VERSION }], [201, { ...result, salesUserId: ADMIN }],
        [201, { ...result, calendarId: `${CALENDAR}\n` }], [200, result], [201, { ...result, replayed: true }], [202, result]])('treats invalid success status=%j data=%j as uncertain', async (status, data) => {
        fetchMock.mockResolvedValue(Response.json({ data }, { status: Number(status) }));
        await expect(workScheduleApi.save(input, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it.each([{ status: 200, body: { error: { code: 'FORBIDDEN', message: 'bad' } } },
        { status: 403, body: { data: result, error: { code: 'FORBIDDEN', message: 'bad' } } },
        { status: 400, body: { error: { code: '', message: 'bad' } } }, { status: 400, body: null }])('keeps ambiguous envelopes %j uncertain', async ({ status, body }) => {
        fetchMock.mockResolvedValue(Response.json(body, { status }));
        await expect(workScheduleApi.save(input, ADMIN)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    });
    it('sanitizes non-JSON/session transport failures without unsafe definite classification', async () => {
        fetchMock.mockResolvedValue(new Response('private html', { status: 503 }));
        let error = await workScheduleApi.save(input, ADMIN).catch(value => value);
        expect(error).toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false }); expect(error.message).not.toContain('private');
        vi.clearAllMocks(); getSession.mockRejectedValue(new Error('private token'));
        error = await workScheduleApi.save(input, ADMIN).catch(value => value);
        expect(error).toMatchObject({ code: 'SESSION_UNAVAILABLE', definitelyNotSaved: false }); expect(error.message).not.toContain('private'); expect(fetchMock).not.toHaveBeenCalled();
    });
});
