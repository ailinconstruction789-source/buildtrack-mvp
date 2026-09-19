// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table call forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import * as route from '@/app/api/sales-crm/work-schedule/route';
const { GET, POST } = route;
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const SALES = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002';
const CALENDAR = '00000000-0000-4000-8000-000000000003';
const VERSION = '00000000-0000-4000-8000-000000000004';
const NEXT = '00000000-0000-4000-8000-000000000005';
const CAPABILITY = 'crm_v2_work_schedule_capabilities', READ = 'crm_v2_work_schedule_snapshot', WRITE = 'crm_v2_publish_work_schedule';
const URL = 'https://app.test/api/sales-crm/work-schedule', TOKEN = 'caller-token';
const input = { requestId: REQUEST, salesUserId: SALES, expectedVersion: VERSION,
    coverage: { startsAt: '2026-09-16T00:00:00.123456+07:00', endsAt: '2026-09-17T00:00:00.123456+07:00' },
    periods: [], confirmedComplete: true, reason: 'วันหยุดที่ยืนยันครบแล้ว' };
const result = { calendarId: CALENDAR, version: NEXT, salesUserId: SALES, replayed: false };
function snapshot(selected: string | null = null) {
    return { actor: { userId: ADMIN, role: 'admin' }, asOf: '2026-09-16T12:00:00.979649+07:00',
        sales: [{ userId: SALES, displayName: null }], salesHasMore: false, selectedSalesUserId: selected, calendar: null };
}
function post(value: unknown = input, headers: Record<string, string> = {}) {
    return new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
function get(query = '', authorization = `Bearer ${TOKEN}`) { return new Request(`${URL}${query ? `?${query}` : ''}`, { headers: { authorization } }); }
function setupRpc(role: unknown = 'admin', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string, args?: { p_sales_user_id: string | null }) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: { contract_version: 'work_schedule_v1', enabled: true }, error: null };
        if (name === READ) return { data: snapshot(args?.p_sales_user_id ?? null), error: null };
        if (name === WRITE) return { data: result, error: null };
        throw new Error('Unexpected RPC');
    });
}
function headers(response: Response) {
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('vary')).toBe('Authorization');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}
async function errorResponse(response: Response, status: number, code: string) {
    expect(response.status).toBe(status); headers(response);
    const body = await response.json(); expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message).not.toMatch(/private|token=secret|CRM_SCHEDULE_|raw SQL/); return body;
}
beforeEach(() => {
    vi.clearAllMocks();
    for (const flag of ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED']) vi.stubEnv(flag, 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
    getUser.mockResolvedValue({ data: { user: { id: ADMIN, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null }); setupRpc();
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, READ, WRITE].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});

describe('work-schedule switch and Admin boundary', () => {
    it('exposes only dynamic Node GET/POST handlers', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic', 'runtime']); expect(route.dynamic).toBe('force-dynamic'); expect(route.runtime).toBe('nodejs');
    });
    for (const flag of ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED']) {
        it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exact true ${flag}=%j before body/client/auth/RPC`, async value => {
            vi.stubEnv(flag, value); const request = post();
            await errorResponse(await POST(request), 503, 'FEATURE_DISABLED'); expect(request.bodyUsed).toBe(false);
            await errorResponse(await GET(get()), 503, 'FEATURE_DISABLED');
            expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
        });
    }
    it.each(['sales', 'owner', null, '', 'super_admin', { role: 'admin' }])('denies trusted non-Admin %j for both reads and writes despite metadata', async role => {
        setupRpc(role); await errorResponse(await GET(get()), 403, 'FORBIDDEN'); await errorResponse(await POST(post()), 403, 'FORBIDDEN');
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_role']);
    });
    it.each(['', 'Basic secret', 'Bearer ', 'Bearer one two', `Bearer ${'a'.repeat(8193)}`])('rejects malformed bearer %j before client creation', async authorization => {
        await errorResponse(await GET(get('', authorization)), 401, 'UNAUTHENTICATED');
        await errorResponse(await POST(post(input, { authorization })), 401, 'UNAUTHENTICATED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ADMIN}\n` }])('requires verified session user UUID %j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null });
        await errorResponse(await POST(post()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('calls getUser and uses only caller-token Authorization on a per-request anon client', async () => {
        expect((await POST(post())).status).toBe(201);
        expect(getUser).toHaveBeenCalledExactlyOnceWith(TOKEN);
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${TOKEN}` } },
        });
    });
    it('rejects auth error even with a user object', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: { message: 'private auth data' } });
        await errorResponse(await GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed when %s is absent', async name => {
        vi.stubEnv(name, ''); await errorResponse(await POST(post()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_forbidden', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged-key misconfiguration %j', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { contract_version: 'work_schedule_v0', enabled: true }, { contract_version: 'work_schedule_v1', enabled: false }, { contract_version: 'work_schedule_v1', enabled: 'true' }])('requires matching enabled capability %j', async data => {
        setupRpc('admin', { [CAPABILITY]: { data } }); await errorResponse(await POST(post()), 503, 'SETUP_REQUIRED'); expect(rpc).toHaveBeenCalledTimes(2);
    });
    it.each(['crm_v2_role', CAPABILITY, READ, WRITE])('reports missing %s without legacy fallback', async name => {
        setupRpc('admin', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } });
        await errorResponse(name === READ ? await GET(get()) : await POST(post()), 503, 'SETUP_REQUIRED');
    });
});

describe('work-schedule read selection and public projection', () => {
    it.each([null, SALES])('binds selected Sales %j and makes no mutation call', async selected => {
        const response = await GET(get(selected === null ? '' : `salesUserId=${selected.toUpperCase()}`));
        expect(response.status).toBe(200); headers(response); expect(await response.json()).toEqual({ data: snapshot(selected) });
        expect(rpc).toHaveBeenLastCalledWith(READ, { p_sales_user_id: selected });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY, READ]);
    });
    it.each(['salesUserId=', 'salesUserId=bad', `salesUserId=${SALES}&salesUserId=${SALES}`, `salesUserId=${SALES}&role=admin`, `salesUserId=${SALES}%0A`])('rejects bad query %j before auth/network', async query => {
        await errorResponse(await GET(get(query)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['actor', 'selection', 'calendarMissing', 'role', 'candidates'])('rejects inconsistent returned %s', async field => {
        const data: Record<string, unknown> = snapshot(SALES);
        if (field === 'actor') data.actor = { userId: SALES, role: 'admin' };
        if (field === 'selection') data.selectedSalesUserId = null;
        if (field === 'calendarMissing') delete data.calendar;
        if (field === 'role') data.actor = { userId: ADMIN, role: 'owner' };
        if (field === 'candidates') data.sales = [];
        setupRpc('admin', { [READ]: { data } }); await errorResponse(await GET(get(`salesUserId=${SALES}`)), 503, 'SETUP_REQUIRED');
    });
    it('strips extra fields rather than leaking private schedule data', async () => {
        setupRpc('admin', { [READ]: { data: { ...snapshot(), privateDump: 'hidden', sales: [{ userId: SALES, displayName: null, leaveReason: 'hidden' }] } } });
        expect(await (await GET(get())).json()).toEqual({ data: snapshot() });
    });
    it.each([{ code: 'XX000', message: 'private raw SQL' }, { code: 'P0001', message: 'CRM_SCHEDULE_IDEMPOTENCY_CONFLICT' }, { code: 'P0001', message: 'CRM_SCHEDULE_STALE_VERSION' }])('uses read-only failure wording for %j', async error => {
        setupRpc('admin', { [READ]: { error } }); const body = await errorResponse(await GET(get()), 503, 'READ_UNAVAILABLE');
        expect(body.error.message).not.toMatch(/รหัสคำขอ|ผลบันทึก|ผลการบันทึก/);
    });
});

describe('bounded schedule publication and safe replay', () => {
    it('forwards exact normalized payload without IDs/actor/times invented by the adapter', async () => {
        const response = await POST(post({ ...input, reason: ` ${input.reason} ` })); expect(response.status).toBe(201); headers(response);
        expect(await response.json()).toEqual({ data: result });
        const { requestId, ...payload } = input;
        expect(rpc).toHaveBeenLastCalledWith(WRITE, { p_request_id: requestId, p_payload: payload });
    });
    it.each(['actor', 'role', 'ownerUserId', 'publishedAt', 'version', 'staffDueAt'])('rejects injected %s before network', async field => {
        await errorResponse(await POST(post({ ...input, [field]: 'untrusted' })), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([{ ...input, reason: '\ud800' }, { ...input, reason: '\udfff' }, { ...input, confirmedComplete: false }, { ...input, expectedVersion: '' },
        { ...input, periods: [{ id: REQUEST, type: 'work', startsAt: input.coverage.startsAt, endsAt: input.coverage.endsAt }] }])('rejects invalid command %j before auth', async value => {
        await errorResponse(await POST(post(value)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it('rejects non-JSON, missing/broken JSON and malformed UTF-8', async () => {
        await errorResponse(await POST(post(input, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
        for (const body of [undefined, '{bad', new Uint8Array([0xff, 0xfe])]) {
            await errorResponse(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), 400, 'INVALID_INPUT');
        } expect(createClient).not.toHaveBeenCalled();
    });
    it.each([{}, { 'content-length': '1' }, { 'content-length': 'unknown' }] as Record<string, string>[])('enforces actual byte size despite declared length %j', async override => {
        await errorResponse(await POST(post({ ...input, reason: 'ก'.repeat(23000) }, override)), 413, 'PAYLOAD_TOO_LARGE'); expect(createClient).not.toHaveBeenCalled();
    });
    it('accepts exactly 64KiB but rejects one byte more without trusting Content-Length', async () => {
        const value = JSON.stringify(input), body = value + ' '.repeat(65536 - new TextEncoder().encode(value).byteLength);
        const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
        expect((await POST(new Request(URL, { method: 'POST', headers, body }))).status).toBe(201);
        await errorResponse(await POST(new Request(URL, { method: 'POST', headers, body: `${body} ` })), 413, 'PAYLOAD_TOO_LARGE');
        expect(createClient).toHaveBeenCalledTimes(1);
    });
    it('cancels chunked streams above 64KiB, before auth/network', async () => {
        const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(30000));
        }, cancel });
        await errorResponse(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)), 413, 'PAYLOAD_TOO_LARGE');
        expect(cancel).toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    });
    it('preserves a Unicode scalar split across stream chunks', async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ ...input, reason: 'ยืนยัน 🙏' }));
        const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
        expect((await POST(new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json;charset=utf-8' }, body, duplex: 'half' } as RequestInit))).status).toBe(201);
        expect(rpc).toHaveBeenLastCalledWith(WRITE, expect.objectContaining({ p_payload: expect.objectContaining({ reason: 'ยืนยัน 🙏' }) }));
    });
    it.each([null, [], {}, { ...result, version: VERSION }, { ...result, salesUserId: ADMIN }, { ...result, calendarId: `${CALENDAR}\n` }, { ...result, replayed: 1 }])('treats incompatible success %j as uncertain, never definitely unsaved', async data => {
        setupRpc('admin', { [WRITE]: { data } }); const body = await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE');
        expect(body.error.message).toContain('รหัสคำขอและข้อมูลเดิม'); expect(rpc.mock.calls.filter(call => call[0] === WRITE)).toHaveLength(1);
    });
    it('projects results and returns200 only for a valid replay, preserving request identity across caller retries', async () => {
        setupRpc('admin', { [WRITE]: { data: {} } }); await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE');
        const original = rpc.mock.calls.find(call => call[0] === WRITE)?.[1];
        setupRpc('admin', { [WRITE]: { data: { ...result, replayed: true, privateDump: 'hidden' } } });
        const response = await POST(post()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { ...result, replayed: true } });
        const calls = rpc.mock.calls.filter(call => call[0] === WRITE); expect(calls).toHaveLength(2); expect(calls[1][1]).toEqual(original);
    });
    it.each([['INVALID_INPUT', 400], ['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['NOT_FOUND', 404], ['STALE_VERSION', 409], ['INACTIVE_TARGET', 409], ['IDEMPOTENCY_CONFLICT', 409]])('maps exact CRM_SCHEDULE_%s without private diagnostics', async (code, status) => {
        setupRpc('admin', { [WRITE]: { error: { code: 'P0001', message: `CRM_SCHEDULE_${code}`, details: 'private raw SQL' } } });
        await errorResponse(await POST(post()), Number(status), String(code));
    });
    it.each([{ code: '23505', message: 'private duplicate' }, { code: 'P0001', message: 'CRM_SCHEDULE_FORBIDDEN extra' }, { code: 'XX000', message: 'CRM_SCHEDULE_FORBIDDEN' }])('keeps unknown error %j uncertain', async error => {
        setupRpc('admin', { [WRITE]: { error } }); await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE');
    });
    it('sanitizes unexpected throws and never automatically retries writes', async () => {
        rpc.mockImplementation(async (name: string) => {
            if (name === 'crm_v2_role') return { data: 'admin', error: null };
            if (name === CAPABILITY) return { data: { contract_version: 'work_schedule_v1', enabled: true }, error: null };
            throw new Error('private token=secret');
        });
        await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE'); expect(rpc.mock.calls.filter(call => call[0] === WRITE)).toHaveLength(1);
    });
});
