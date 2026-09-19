// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table access forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import * as route from '@/app/api/sales-crm/sla-cycles/route';

const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002', CHILD = '00000000-0000-4000-8000-000000000003';
const TASK = '00000000-0000-4000-8000-000000000004', INPUT = { requestId: REQUEST }, actor = { userId: ADMIN, role: 'admin' };
const START = '2026-09-17T02:45:00.123456Z', FINISH = '2026-09-17T02:45:01.123456Z';
const READ_FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED'];
const WRITE_FLAGS = ['SALES_CRM_SLA_PROCESSING_ENABLED', 'SALES_CRM_SLA_CYCLE_ENABLED'];
const CAPABILITY = 'crm_v2_sla_cycle_capabilities', PROCESS = 'crm_v2_process_first_contact_cycle', READ = 'crm_v2_first_contact_cycle_receipt';
const URL = 'https://app.test/api/sales-crm/sla-cycles', QUERY = `requestId=${REQUEST}`;
function child() {
    return { actor, requestId: CHILD, taskId: TASK, processedAt: START, replayed: false, outcome: 'held', reason: 'MISSING_CALENDAR',
        serviceDueAt: '2026-09-18T03:00:00Z', staffDueAt: null, notificationId: null, notificationType: null,
        completedByActivityId: null, completedAt: null, withdrawnCount: 0 };
}
function cycle() { return { actor, ...INPUT, startedAt: START, finishedAt: FINISH, replayed: false, maxItems: 10, processedCount: 1, sweepFinished: true, receipts: [child()] }; }
function lookup() { return { actor, ...INPUT, found: true, receipt: cycle() }; }
const capability = (processing_enabled = true) => ({ contract_version: 'first_contact_cycle_v1', enabled: true, processing_enabled });
function post(value: unknown = INPUT, headers: Record<string, string> = {}, query = '') {
    return new Request(`${URL}${query}`, { method: 'POST', headers: { authorization: 'Bearer caller-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
const get = (query = '', authorization = 'Bearer caller-token') => new Request(`${URL}${query ? `?${query}` : ''}`, { headers: { authorization } });
function setupRpc(role: unknown = 'admin', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: capability(), error: null };
        if (name === PROCESS) return { data: cycle(), error: null };
        if (name === READ) return { data: lookup(), error: null };
        throw new Error('Unexpected RPC, legacy fallback forbidden');
    });
}
async function errorResponse(response: Response, status: number, code: string, definite?: boolean) {
    expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json();
    expect(body).toEqual({ error: { code, message: expect.any(String), ...(definite === undefined ? {} : { definitelyNotProcessed: definite }) } });
    expect(body.error.message).not.toMatch(/private|raw SQL|token=secret|CRM_SLA_/); return body;
}
beforeEach(() => {
    vi.clearAllMocks(); [...READ_FLAGS, ...WRITE_FLAGS].forEach(flag => vi.stubEnv(flag, 'true'));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
    getUser.mockResolvedValue({ data: { user: { id: ADMIN, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null }); setupRpc();
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled(); expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, PROCESS, READ].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});

describe('dormant bounded cycle route and exact gates', () => {
    it('exports only GET/POST and dynamic Node runtime, with no import-time call', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic', 'runtime']);
        expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic'); expect(createClient).not.toHaveBeenCalled();
    });
    for (const flag of READ_FLAGS) it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exact ${flag}=%j for both methods before auth`, async value => {
        vi.stubEnv(flag, value); const request = post();
        await errorResponse(await route.GET(get()), 503, 'FEATURE_DISABLED');
        await errorResponse(await route.POST(request), 503, 'FEATURE_DISABLED', true);
        expect(request.bodyUsed).toBe(false); expect(createClient).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });
    for (const flag of WRITE_FLAGS) it.each([undefined, '', 'false', 'TRUE', '1'])(`keeps GET recovery but blocks POST with ${flag}=%j`, async value => {
        vi.stubEnv(flag, value);
        expect(await (await route.GET(get())).json()).toEqual({ data: { actor, processingEnabled: false, maxItems: 10 } });
        expect(await (await route.GET(get(QUERY))).json()).toEqual({ data: lookup() });
        const request = post(); await errorResponse(await route.POST(request), 503, 'FEATURE_DISABLED', true);
        expect(request.bodyUsed).toBe(false); expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it.each([false, true])('DB processing_enabled=%s participates in write permission but not receipt reads', async enabled => {
        setupRpc('admin', { [CAPABILITY]: { data: capability(enabled) } });
        expect(await (await route.GET(get())).json()).toEqual({ data: { actor, processingEnabled: enabled, maxItems: 10 } });
        expect((await route.GET(get(QUERY))).status).toBe(200);
        if (enabled) expect((await route.POST(post())).status).toBe(200);
        else { await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true); expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false); }
    });
    it('GET context never reads a receipt, processes, or advances a cursor', async () => {
        expect(await (await route.GET(get())).json()).toEqual({ data: { actor, processingEnabled: true, maxItems: 10 } });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY]);
    });
});

describe('trusted Admin JWT and public-key-only authority', () => {
    it.each(['sales', 'owner', '', null, { role: 'admin' }])('ignores editable metadata and rejects trusted role %j', async role => {
        setupRpc(role); await errorResponse(await route.GET(get(QUERY)), 403, 'FORBIDDEN');
        await errorResponse(await route.POST(post()), 403, 'FORBIDDEN', true);
        expect(rpc.mock.calls.every(call => call[0] === 'crm_v2_role')).toBe(true);
    });
    it.each(['', 'Basic secret', 'Bearer ', 'Bearer two tokens', `Bearer ${'x'.repeat(8193)}`])('rejects invalid bearer %j', async authorization => {
        await errorResponse(await route.GET(get('', authorization)), 401, 'UNAUTHENTICATED');
        await errorResponse(await route.POST(post(INPUT, { authorization })), 401, 'UNAUTHENTICATED', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ADMIN}\n` }])('requires a verified canonicalizable UUID user %j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null });
        await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED');
        await errorResponse(await route.POST(post()), 401, 'UNAUTHENTICATED', true); expect(rpc).not.toHaveBeenCalled();
    });
    it('rejects auth error even alongside a user', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: { message: 'private' } });
        await errorResponse(await route.POST(post()), 401, 'UNAUTHENTICATED', true); expect(rpc).not.toHaveBeenCalled();
    });
    it('uses only the verified caller token and disables persistent SDK sessions', async () => {
        expect((await route.POST(post())).status).toBe(200); expect(getUser).toHaveBeenCalledExactlyOnceWith('caller-token');
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer caller-token' } },
        });
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing %s', async name => {
        vi.stubEnv(name, ''); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
        await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_private', ' sb_secret_private ', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged or padded key %s', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
        await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { ...capability(), contract_version: 'wrong' }, { ...capability(), enabled: false },
        { ...capability(), enabled: 'true' }, { contract_version: 'first_contact_cycle_v1', enabled: true },
        { ...capability(), processing_enabled: 'true' }])('rejects malformed capability %j before any processor', async data => {
        setupRpc('admin', { [CAPABILITY]: { data } }); await errorResponse(await route.GET(get(QUERY)), 503, 'SETUP_REQUIRED');
        await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true);
        expect(rpc.mock.calls.some(call => call[0] === PROCESS || call[0] === READ)).toBe(false);
    });
});

describe('strict bounded command/body/query inputs', () => {
    it.each(['actor', 'taskId', 'taskIds', 'maxItems', 'cursor', 'ownerUserId', 'staffDueAt', 'policy', 'force', 'receipts'])('rejects injected %s before auth', async field => {
        await errorResponse(await route.POST(post({ ...INPUT, [field]: 'untrusted' })), 400, 'INVALID_INPUT', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { requestId: 'bad' }, { requestId: `${REQUEST}\n` }])('rejects malformed POST %j', async value => {
        await errorResponse(await route.POST(post(value)), 400, 'INVALID_INPUT', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([`?requestId=${REQUEST}`, '?maxItems=10', '?force=true'])('rejects all POST query parameters %s', async query => {
        await errorResponse(await route.POST(post(INPUT, {}, query)), 400, 'INVALID_INPUT', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['requestId=', 'requestId=bad', `requestId=${REQUEST}%0A`, `${QUERY}&requestId=${REQUEST}`, `${QUERY}&actorId=${ADMIN}`,
        `${QUERY}&maxItems=10`, 'process=true', 'page=0'])('rejects malformed GET query %s before auth', async query => {
        await errorResponse(await route.GET(get(query)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it('rejects non-JSON, missing, malformed and invalid UTF8 bodies', async () => {
        await errorResponse(await route.POST(post(INPUT, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE', true);
        for (const body of [undefined, '{bad', new Uint8Array([0xff, 0xfe])]) {
            await errorResponse(await route.POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), 400, 'INVALID_INPUT', true);
        }
        expect(createClient).not.toHaveBeenCalled();
    });
    it.each([{}, { 'content-length': '1' }, { 'content-length': 'invalid' }] as Record<string, string>[])('enforces bytes despite claimed length %j', async headers => {
        await errorResponse(await route.POST(post({ requestId: 'ก'.repeat(1500) }, headers)), 413, 'PAYLOAD_TOO_LARGE', true); expect(createClient).not.toHaveBeenCalled();
    });
    it('accepts exactly 4096 bytes and rejects the next byte', async () => {
        const encoded = JSON.stringify(INPUT), body = encoded + ' '.repeat(4096 - encoded.length);
        const headers = { authorization: 'Bearer caller-token', 'content-type': 'application/json; charset=utf-8' };
        expect((await route.POST(new Request(URL, { method: 'POST', headers, body }))).status).toBe(200);
        await errorResponse(await route.POST(new Request(URL, { method: 'POST', headers, body: `${body} ` })), 413, 'PAYLOAD_TOO_LARGE', true);
        expect(createClient).toHaveBeenCalledTimes(1);
    });
    it('rejects declared oversize before reading the body', async () => {
        const request = post(INPUT, { 'content-length': '4097' }); await errorResponse(await route.POST(request), 413, 'PAYLOAD_TOO_LARGE', true);
        expect(request.bodyUsed).toBe(false); expect(createClient).not.toHaveBeenCalled();
    });
    it('cancels an over-limit stream before any auth call', async () => {
        const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4000)); controller.enqueue(new Uint8Array(200)); }, cancel });
        await errorResponse(await route.POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)), 413, 'PAYLOAD_TOO_LARGE', true);
        expect(cancel).toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    });
});

describe('minimal result binding and read-only recovery', () => {
    it('passes only normalized request ID once and strips all parent and child private fields', async () => {
        setupRpc('admin', { [PROCESS]: { data: { ...cycle(), requestId: ADMIN, cursor: {}, private: 'private',
            receipts: [{ ...child(), income: 100, calendar: {}, actor: { ...actor, email: 'private' } }] } } });
        expect(await (await route.POST(post({ requestId: ADMIN.toUpperCase() }))).json()).toEqual({ data: { ...cycle(), requestId: ADMIN } });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY, PROCESS]);
        expect(rpc).toHaveBeenLastCalledWith(PROCESS, { p_request: { requestId: ADMIN } });
    });
    it('looks up only the normalized own request without invoking any processor', async () => {
        const value = { ...lookup(), requestId: ADMIN, receipt: { ...cycle(), requestId: ADMIN } };
        setupRpc('admin', { [READ]: { data: { ...value, cursor: {}, requestPayload: {} } } });
        expect(await (await route.GET(get(`requestId=${ADMIN.toUpperCase()}`))).json()).toEqual({ data: value });
        expect(rpc).toHaveBeenLastCalledWith(READ, { p_request: { requestId: ADMIN } }); expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it('not-found returns no proof of noncommit', async () => {
        setupRpc('admin', { [READ]: { data: { actor, ...INPUT, found: false, receipt: null, definitelyNotProcessed: true } } });
        expect(await (await route.GET(get(QUERY))).json()).toEqual({ data: { actor, ...INPUT, found: false, receipt: null } });
    });
    it.each([null, [], {}, { ...cycle(), actor: { userId: OTHER, role: 'admin' } }, { ...cycle(), requestId: OTHER },
        { ...cycle(), processedCount: 2 }, { ...cycle(), maxItems: 11 }, { ...cycle(), sweepFinished: false },
        { ...cycle(), receipts: [{ ...child(), replayed: true }] }, { ...cycle(), receipts: [{ ...child(), actor: { userId: OTHER, role: 'admin' } }] },
        { ...cycle(), receipts: [{ ...child(), processedAt: '2026-09-17T02:45:01.123457Z' }] },
        { ...cycle(), processedCount: 2, receipts: [child(), child()] }])('keeps malformed or unbound successful POST uncertain %j', async data => {
        setupRpc('admin', { [PROCESS]: { data } }); await errorResponse(await route.POST(post()), 503, 'UNKNOWN_RESULT', false);
        expect(rpc.mock.calls.filter(call => call[0] === PROCESS)).toHaveLength(1);
    });
    it.each([null, {}, { ...lookup(), actor: { userId: OTHER, role: 'admin' } }, { ...lookup(), requestId: OTHER },
        { ...lookup(), found: false }, { ...lookup(), receipt: { ...cycle(), processedCount: 2 } }])('rejects malformed lookup without a processor %j', async data => {
        setupRpc('admin', { [READ]: { data } }); await errorResponse(await route.GET(get(QUERY)), 503, 'SETUP_REQUIRED');
        expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it('an explicit retry forwards the same input and preserves the historical replay result', async () => {
        expect((await route.POST(post())).status).toBe(200); setupRpc('admin', { [PROCESS]: { data: { ...cycle(), replayed: true } } });
        expect(await (await route.POST(post())).json()).toEqual({ data: { ...cycle(), replayed: true } });
        const calls = rpc.mock.calls.filter(call => call[0] === PROCESS); expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1]);
    });
});

describe('phase-aware safe failure projection', () => {
    it.each(['getUser', 'crm_v2_role', CAPABILITY])('precheck thrown %s proves this attempt did not invoke processor', async phase => {
        if (phase === 'getUser') getUser.mockRejectedValueOnce(new Error('private token=secret'));
        else { const configured = rpc.getMockImplementation()!; rpc.mockImplementation(async name => { if (name === phase) throw new Error('private'); return configured(name); }); }
        await errorResponse(await route.POST(post()), 503, 'PRECHECK_UNAVAILABLE', true);
        expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it('a thrown processing transport failure is uncertain and never auto-retried', async () => {
        const configured = rpc.getMockImplementation()!; rpc.mockImplementation(async name => { if (name === PROCESS) throw new Error('private raw SQL'); return configured(name); });
        await errorResponse(await route.POST(post()), 503, 'UNKNOWN_RESULT', false); expect(rpc.mock.calls.filter(call => call[0] === PROCESS)).toHaveLength(1);
    });
    it.each([['INVALID_INPUT', 400], ['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['BUSY', 503]])('maps exact cycle abort %s only for current attempt', async (code, status) => {
        setupRpc('admin', { [PROCESS]: { error: { code: 'P0001', message: `CRM_SLA_CYCLE_${code}`, details: 'private' } } });
        await errorResponse(await route.POST(post()), Number(status), String(code), true);
    });
    it.each([{ code: 'P0001', message: 'CRM_SLA_CYCLE_BUSY extra' }, { code: 'XX000', message: 'CRM_SLA_CYCLE_BUSY' },
        { code: 'P0001', message: 'CRM_SLA_PROCESS_FORBIDDEN' }, { code: '23505', message: 'private raw SQL' },
        { code: 'PGRST202', message: 'private missing nested RPC' }, { code: '42501', message: 'private' }])('does not infer noncommit from other processor errors %j', async error => {
        setupRpc('admin', { [PROCESS]: { error } }); await errorResponse(await route.POST(post()), 503, 'UNKNOWN_RESULT', false);
    });
    it.each(['crm_v2_role', CAPABILITY])('reports missing %s before processor without any fallback', async name => {
        setupRpc('admin', { [name]: { error: { code: 'PGRST202', message: 'private missing' } } });
        await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true); expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it('unknown capability error is a known precheck failure only', async () => {
        setupRpc('admin', { [CAPABILITY]: { error: { code: 'XX000', message: 'private' } } });
        await errorResponse(await route.POST(post()), 503, 'PRECHECK_UNAVAILABLE', true);
    });
    it.each(['crm_v2_role', CAPABILITY, READ])('read-side missing %s stays unavailable without processing', async name => {
        setupRpc('admin', { [name]: { error: { code: 'PGRST202', message: 'private' } } });
        await errorResponse(await route.GET(get(QUERY)), 503, 'SETUP_REQUIRED'); expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it('read transport errors return no definitelyNotProcessed claim', async () => {
        rpc.mockRejectedValueOnce(new Error('private token=secret')); await errorResponse(await route.GET(get(QUERY)), 503, 'READ_UNAVAILABLE');
        expect(rpc).toHaveBeenCalledOnce();
    });
    it.each([['42501', 'FORBIDDEN', 403], ['PGRST301', 'UNAUTHENTICATED', 401], ['XX000', 'READ_UNAVAILABLE', 503]])('maps safe read error %s', async (code, publicCode, status) => {
        setupRpc('admin', { [READ]: { error: { code, message: 'private' } } });
        await errorResponse(await route.GET(get(QUERY)), Number(status), String(publicCode));
    });
});
