// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table call forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import * as route from '@/app/api/sales-crm/notifications/route';
const { GET, POST } = route;
const ACTOR = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const NOTICE = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T12:00:00.123456Z';
const CAPABILITY = 'crm_v2_notifications_capabilities', READ = 'crm_v2_notifications_snapshot', WRITE = 'crm_v2_mark_notification_read';
const URL = 'https://app.test/api/sales-crm/notifications', TOKEN = 'caller-token';
const FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED', 'SALES_CRM_NOTIFICATIONS_ENABLED'];
const input = { notificationId: NOTICE }, result = { notificationId: NOTICE, readAt: AT };
function snapshot(page = 0, role: unknown = 'sales') {
    return { actor: { userId: ACTOR, role }, asOf: AT, page, pageSize: 50, hasMore: false, unreadCount: 1,
        notifications: [{ id: NOTICE, taskId: TASK, customerId: CUSTOMER, interestId: null, customerName: 'ลูกค้า', projectName: null,
            taskType: 'first_contact', type: 'due_soon', availableAt: AT, createdAt: AT, readAt: null, staffDueAt: AT, serviceDueAt: AT }] };
}
function post(value: unknown = input, headers: Record<string, string> = {}, query = '') {
    return new Request(`${URL}${query}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
function get(query = '', authorization = `Bearer ${TOKEN}`) { return new Request(`${URL}${query ? `?${query}` : ''}`, { headers: { authorization } }); }
function setupRpc(role: unknown = 'sales', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string, args?: { p_page: number }) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: { contract_version: 'notifications_v1', enabled: true }, error: null };
        if (name === READ) return { data: snapshot(args?.p_page ?? 0, role), error: null };
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
    expect(body.error.message).not.toMatch(/private|token=secret|CRM_NOTIFICATION_|raw SQL/); return body;
}
beforeEach(() => {
    vi.clearAllMocks(); for (const flag of FLAGS) vi.stubEnv(flag, 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
    getUser.mockResolvedValue({ data: { user: { id: ACTOR, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null }); setupRpc();
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, READ, WRITE].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});

describe('notification gates and trusted actor boundary', () => {
    it('exports only dynamic Node GET/POST', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic', 'runtime']); expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic');
    });
    for (const flag of FLAGS) {
        it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exact true ${flag}=%j before any request/body/auth work`, async value => {
            vi.stubEnv(flag, value); const request = post();
            await errorResponse(await POST(request), 503, 'FEATURE_DISABLED'); expect(request.bodyUsed).toBe(false);
            await errorResponse(await GET(get()), 503, 'FEATURE_DISABLED');
            expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
        });
    }
    it.each(['sales', 'admin', 'owner'])('permits trusted own-inbox role %s', async role => {
        setupRpc(role); const response = await GET(get()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: snapshot(0, role) });
        expect((await POST(post())).status).toBe(200);
    });
    it.each(['foreman', '', null, 'super_admin', { role: 'admin' }])('rejects unsupported trusted role %j regardless of metadata', async role => {
        setupRpc(role); await errorResponse(await GET(get()), 403, 'FORBIDDEN'); await errorResponse(await POST(post()), 403, 'FORBIDDEN');
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_role']);
    });
    it.each(['', 'Basic secret', 'Bearer ', 'Bearer two tokens', `Bearer ${'a'.repeat(8193)}`])('requires bounded bearer %j', async authorization => {
        await errorResponse(await GET(get('', authorization)), 401, 'UNAUTHENTICATED');
        await errorResponse(await POST(post(input, { authorization })), 401, 'UNAUTHENTICATED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ACTOR}\n` }])('requires verified UUID user %j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null }); await errorResponse(await POST(post()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('rejects auth errors even when a user object accompanies them', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ACTOR } }, error: { message: 'private' } });
        await errorResponse(await GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('uses verified caller token and per-request public-key client only', async () => {
        expect((await POST(post())).status).toBe(200); expect(getUser).toHaveBeenCalledExactlyOnceWith(TOKEN);
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${TOKEN}` } },
        });
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing %s', async flag => {
        vi.stubEnv(flag, ''); await errorResponse(await GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_privileged', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged key configuration %s', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await POST(post()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { contract_version: 'notifications_v0', enabled: true }, { contract_version: 'notifications_v1', enabled: false },
        { contract_version: 'notifications_v1', enabled: 'true' }])('requires exact enabled capability %j', async data => {
        setupRpc('sales', { [CAPABILITY]: { data } }); await errorResponse(await POST(post()), 503, 'SETUP_REQUIRED'); expect(rpc).toHaveBeenCalledTimes(2);
    });
    it.each(['crm_v2_role', CAPABILITY, READ, WRITE])('does not fall back when %s missing', async name => {
        setupRpc('sales', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } });
        await errorResponse(name === READ ? await GET(get()) : await POST(post()), 503, 'SETUP_REQUIRED');
    });
});

describe('notification read projection and no impersonation', () => {
    it.each(['', 'page=0', 'page=1000'])('reads canonical page %s with no recipient selector or mutation', async query => {
        const page = query === 'page=1000' ? 1000 : 0, response = await GET(get(query));
        expect(response.status).toBe(200); headers(response); expect(await response.json()).toEqual({ data: snapshot(page) });
        expect(rpc).toHaveBeenLastCalledWith(READ, { p_page: page }); expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY, READ]);
    });
    it.each(['page=', 'page=-0', 'page=01', 'page=1001', 'page=1&page=1', 'page=0%0A', `recipientId=${CUSTOMER}`, 'page=0&role=admin'])('rejects invalid/impersonation query %s before network', async query => {
        await errorResponse(await GET(get(query)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['actor', 'role', 'page', 'size', 'unread', 'duplicate'])('rejects inconsistent returned %s', async field => {
        const data: Record<string, unknown> = snapshot();
        if (field === 'actor') data.actor = { userId: CUSTOMER, role: 'sales' };
        if (field === 'role') data.actor = { userId: ACTOR, role: 'admin' };
        if (field === 'page') data.page = 1;
        if (field === 'size') data.pageSize = 500;
        if (field === 'unread') data.unreadCount = 0;
        if (field === 'duplicate') data.notifications = [snapshot().notifications[0], snapshot().notifications[0]];
        setupRpc('sales', { [READ]: { data } }); await errorResponse(await GET(get()), 503, 'SETUP_REQUIRED');
    });
    it('strips raw message/private evidence and never returns arbitrary links', async () => {
        setupRpc('sales', { [READ]: { data: { ...snapshot(), privateDump: 'hidden', notifications: [{ ...snapshot().notifications[0],
            message: 'private', phone: 'private', income: 5000, url: 'https://evil.test', evaluationSnapshot: {} }] } } });
        expect(await (await GET(get())).json()).toEqual({ data: snapshot() });
    });
    it('uses read-only language for unknown backend errors', async () => {
        setupRpc('sales', { [READ]: { error: { code: 'XX000', message: 'private raw SQL' } } });
        const body = await errorResponse(await GET(get()), 503, 'READ_UNAVAILABLE'); expect(body.error.message).not.toContain('ผลอ่านแล้ว');
    });
});

describe('bounded monotonic acknowledgment command', () => {
    it('forwards only normalized ID and returns projected200', async () => {
        setupRpc('sales', { [WRITE]: { data: { notificationId: ACTOR, readAt: AT, privateDump: 'hidden' } } });
        const response = await POST(post({ notificationId: ACTOR.toUpperCase() })); expect(response.status).toBe(200); headers(response);
        expect(await response.json()).toEqual({ data: { notificationId: ACTOR, readAt: AT } });
        expect(rpc).toHaveBeenLastCalledWith(WRITE, { p_notification_id: ACTOR });
    });
    it.each(['readAt', 'recipientId', 'actorId', 'role', 'requestId', 'read', 'completedAt'])('rejects injected %s before network', async field => {
        await errorResponse(await POST(post({ ...input, [field]: 'untrusted' })), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it('rejects POST query rather than silently ignoring it', async () => {
        await errorResponse(await POST(post(input, {}, '?page=0')), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it('rejects media type, malformedJSON, missing body and malformed UTF8 before auth', async () => {
        await errorResponse(await POST(post(input, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
        for (const body of [undefined, '{bad', new Uint8Array([0xff, 0xfe])]) {
            await errorResponse(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), 400, 'INVALID_INPUT');
        } expect(createClient).not.toHaveBeenCalled();
    });
    it.each([{}, { 'content-length': '1' }, { 'content-length': 'invalid' }] as Record<string, string>[])('enforces actual8KiB despite declared length %j', async override => {
        await errorResponse(await POST(post({ notificationId: 'ก'.repeat(3000) }, override)), 413, 'PAYLOAD_TOO_LARGE'); expect(createClient).not.toHaveBeenCalled();
    });
    it('accepts exactly8KiB but not one byte extra', async () => {
        const value = JSON.stringify(input), body = value + ' '.repeat(8192 - value.length);
        const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
        expect((await POST(new Request(URL, { method: 'POST', headers, body }))).status).toBe(200);
        await errorResponse(await POST(new Request(URL, { method: 'POST', headers, body: `${body} ` })), 413, 'PAYLOAD_TOO_LARGE'); expect(createClient).toHaveBeenCalledTimes(1);
    });
    it('rejects oversized Content-Length before reading body', async () => {
        const request = post(input, { 'content-length': '8193' });
        await errorResponse(await POST(request), 413, 'PAYLOAD_TOO_LARGE'); expect(request.bodyUsed).toBe(false); expect(createClient).not.toHaveBeenCalled();
    });
    it('cancels oversized streams before auth', async () => {
        const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8000)); controller.enqueue(new Uint8Array(200)); }, cancel });
        await errorResponse(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)), 413, 'PAYLOAD_TOO_LARGE');
        expect(cancel).toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { notificationId: CUSTOMER, readAt: AT }, { notificationId: NOTICE, readAt: null }, { notificationId: NOTICE, readAt: `${AT}\n` }])('treats invalid success %j as uncertain without retry', async data => {
        setupRpc('sales', { [WRITE]: { data } }); const body = await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE');
        expect(body.error.message).toContain('รายการเดิม'); expect(rpc.mock.calls.filter(call => call[0] === WRITE)).toHaveLength(1);
    });
    it('allows explicit same-ID retry without minting a receipt or changing read time', async () => {
        const first = await POST(post()), second = await POST(post()); expect(await first.json()).toEqual(await second.json());
        const calls = rpc.mock.calls.filter(call => call[0] === WRITE); expect(calls).toHaveLength(2); expect(calls[1][1]).toEqual(calls[0][1]);
    });
    it.each([['INVALID_INPUT', 400], ['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['NOT_AVAILABLE', 404]])('maps exact CRM_NOTIFICATION_%s only', async (code, status) => {
        setupRpc('sales', { [WRITE]: { error: { code: 'P0001', message: `CRM_NOTIFICATION_${code}`, details: 'private' } } });
        await errorResponse(await POST(post()), Number(status), String(code));
    });
    it.each([{ code: '23505', message: 'private' }, { code: 'P0001', message: 'CRM_NOTIFICATION_FORBIDDEN extra' }, { code: 'XX000', message: 'CRM_NOTIFICATION_FORBIDDEN' }])('keeps unknown errors %j uncertain', async error => {
        setupRpc('sales', { [WRITE]: { error } }); await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE');
    });
    it('sanitizes thrown failures and does not automatically retry or complete tasks', async () => {
        const configured = rpc.getMockImplementation()!; rpc.mockImplementation(async (name, args) => { if (name === WRITE) throw new Error('private token=secret'); return configured(name, args); });
        await errorResponse(await POST(post()), 503, 'SERVICE_UNAVAILABLE'); expect(rpc.mock.calls.filter(call => call[0] === WRITE)).toHaveLength(1);
    });
});
