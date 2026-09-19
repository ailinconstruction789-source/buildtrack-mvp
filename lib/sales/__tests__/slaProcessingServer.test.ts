// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table access forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import * as route from '@/app/api/sales-crm/sla-process/route';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002', TASK = '00000000-0000-4000-8000-000000000003';
const NOTICE = '00000000-0000-4000-8000-000000000004', ACTIVITY = '00000000-0000-4000-8000-000000000005';
const AT = '2026-09-17T02:45:00.123456Z', DUE = '2026-09-17T03:00:00.123456Z';
const INPUT = { requestId: REQUEST, taskId: TASK };
const FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED', 'SALES_CRM_SLA_PROCESSING_ENABLED'];
const CAPABILITY = 'crm_v2_sla_processing_capabilities', PROCESS = 'crm_v2_process_first_contact';
const URL = 'https://app.test/api/sales-crm/sla-process';
function receipt() { return { actor: { userId: ADMIN, role: 'admin' }, ...INPUT, processedAt: AT, replayed: false,
    outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: DUE, staffDueAt: null, notificationId: null, notificationType: null,
    completedByActivityId: null, completedAt: null, withdrawnCount: 0 }; }
function post(value: unknown = INPUT, headers: Record<string, string> = {}, query = '') {
    return new Request(`${URL}${query}`, { method: 'POST', headers: { authorization: 'Bearer caller-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
function setupRpc(role: unknown = 'admin', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: { contract_version: 'first_contact_processing_v1', enabled: true }, error: null };
        if (name === PROCESS) return { data: receipt(), error: null };
        throw new Error('Unexpected RPC');
    });
}
async function errorResponse(response: Response, status: number, code: string, definitelyNotProcessed: boolean) {
    expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json(); expect(body).toEqual({ error: { code, message: expect.any(String), definitelyNotProcessed } });
    expect(body.error.message).not.toMatch(/private|raw SQL|token=secret|CRM_SLA_PROCESS_/); return body;
}
beforeEach(() => {
    vi.clearAllMocks(); FLAGS.forEach(flag => vi.stubEnv(flag, 'true'));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
    getUser.mockResolvedValue({ data: { user: { id: ADMIN, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null }); setupRpc();
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled(); expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, PROCESS].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});

describe('processing gates and trusted Admin authority', () => {
    it('exports POST only with dynamic Node runtime', () => {
        expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic', 'runtime']); expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic');
    });
    for (const flag of FLAGS) it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exact true ${flag}=%j before body/auth`, async value => {
        vi.stubEnv(flag, value); const request = post(); await errorResponse(await route.POST(request), 503, 'FEATURE_DISABLED', true);
        expect(request.bodyUsed).toBe(false); expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });
    it.each(['sales', 'owner', 'foreman', '', null, { role: 'admin' }])('rejects trusted role%j despite editable metadata', async role => {
        setupRpc(role); await errorResponse(await route.POST(post()), 403, 'FORBIDDEN', true); expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role']);
    });
    it.each(['', 'Basic secret', 'Bearer ', 'Bearer two tokens', `Bearer ${'x'.repeat(8193)}`])('rejects malformed bearer%j', async authorization => {
        await errorResponse(await route.POST(post(INPUT, { authorization })), 401, 'UNAUTHENTICATED', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ADMIN}\n` }])('requires verified valid UUIDuser%j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null }); await errorResponse(await route.POST(post()), 401, 'UNAUTHENTICATED', true); expect(rpc).not.toHaveBeenCalled();
    });
    it('rejects auth errors even if user accompanies them', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: { message: 'private' } });
        await errorResponse(await route.POST(post()), 401, 'UNAUTHENTICATED', true); expect(rpc).not.toHaveBeenCalled();
    });
    it('uses only verified caller JWT with public key and no persistent session', async () => {
        expect((await route.POST(post())).status).toBe(200); expect(getUser).toHaveBeenCalledExactlyOnceWith('caller-token');
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer caller-token' } },
        });
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing%s', async flag => {
        vi.stubEnv(flag, ''); await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_private', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged key%s', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { contract_version: 'wrong', enabled: true }, { contract_version: 'first_contact_processing_v1', enabled: false },
        { contract_version: 'first_contact_processing_v1', enabled: 'true' }])('fails before processor on malformed capability%j', async data => {
        setupRpc('admin', { [CAPABILITY]: { data } }); await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true);
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY]);
    });
});
describe('bounded UTF8 command-only request', () => {
    it.each(['actor', 'ownerUserId', 'staffDueAt', 'serviceDueAt', 'calendar', 'preview', 'notificationId', 'completedAt', 'force'])('rejects injected%s before network', async field => {
        await errorResponse(await route.POST(post({ ...INPUT, [field]: 'untrusted' })), 400, 'INVALID_INPUT', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { taskId: TASK }, { ...INPUT, requestId: `${REQUEST}\n` }, { ...INPUT, taskId: 'bad' }])('rejects invalidcommand%j', async value => {
        await errorResponse(await route.POST(post(value)), 400, 'INVALID_INPUT', true); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['?page=0', '?force=true'])('rejects anyquery%s before network', async query => {
        await errorResponse(await route.POST(post(INPUT, {}, query)), 400, 'INVALID_INPUT', true); expect(createClient).not.toHaveBeenCalled();
    });
    it('rejects nonJSONmedia and malformed/missing/nonUTF8 bodies', async () => {
        await errorResponse(await route.POST(post(INPUT, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE', true);
        for (const body of [undefined, '{broken', new Uint8Array([0xff, 0xfe])]) {
            await errorResponse(await route.POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), 400, 'INVALID_INPUT', true);
        } expect(createClient).not.toHaveBeenCalled();
    });
    it.each([{}, { 'content-length': '1' }, { 'content-length': 'invalid' }] as Record<string, string>[])('enforces actualbytebound despite declaredlength%j', async headers => {
        await errorResponse(await route.POST(post({ ...INPUT, taskId: 'ก'.repeat(1500) }, headers)), 413, 'PAYLOAD_TOO_LARGE', true); expect(createClient).not.toHaveBeenCalled();
    });
    it('accepts exactly4096bytes but not4097', async () => {
        const encoded = JSON.stringify(INPUT), body = encoded + ' '.repeat(4096 - encoded.length);
        const headers = { authorization: 'Bearer caller-token', 'content-type': 'application/json; charset=utf-8' };
        expect((await route.POST(new Request(URL, { method: 'POST', headers, body }))).status).toBe(200);
        await errorResponse(await route.POST(new Request(URL, { method: 'POST', headers, body: `${body} ` })), 413, 'PAYLOAD_TOO_LARGE', true);
        expect(createClient).toHaveBeenCalledTimes(1);
    });
    it('rejects oversized ContentLength before bodyread', async () => {
        const request = post(INPUT, { 'content-length': '4097' }); await errorResponse(await route.POST(request), 413, 'PAYLOAD_TOO_LARGE', true);
        expect(request.bodyUsed).toBe(false); expect(createClient).not.toHaveBeenCalled();
    });
    it('cancels oversized streams before auth', async () => {
        const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4000)); controller.enqueue(new Uint8Array(200)); }, cancel });
        await errorResponse(await route.POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)), 413, 'PAYLOAD_TOO_LARGE', true);
        expect(cancel).toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    });
});
describe('bound minimal historical receipt and phase-aware uncertainty', () => {
    it('forwards only normalized command once and strips private receipt details', async () => {
        setupRpc('admin', { [PROCESS]: { data: { ...receipt(), requestId: ADMIN, calendar: {}, ownerIncome: 100, rawEvaluation: {} } } });
        const response = await route.POST(post({ ...INPUT, requestId: ADMIN.toUpperCase() })); expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { ...receipt(), requestId: ADMIN } });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY, PROCESS]);
        expect(rpc).toHaveBeenLastCalledWith(PROCESS, { p_request: { requestId: ADMIN, taskId: TASK } });
    });
    it.each([
        { outcome: 'notified', reason: 'DUE_SOON', staffDueAt: DUE, notificationId: NOTICE, notificationType: 'due_soon' },
        { outcome: 'already_notified', reason: 'DUE_SOON', staffDueAt: DUE, notificationId: NOTICE, notificationType: 'due_soon', replayed: true },
        { outcome: 'completed', reason: 'CONTACT_PROVEN', completedByActivityId: ACTIVITY, completedAt: AT, withdrawnCount: 3 },
        { outcome: 'closed', reason: 'TASK_CLOSED' },
        { outcome: 'scheduled', reason: 'OUTSIDE_WORKING_HOURS', staffDueAt: DUE },
        { outcome: 'suppressed', reason: 'WITHDRAWN_NOTIFICATION', staffDueAt: DUE },
    ])('accepts exact contract historicalreceipt%j', async patch => {
        const data = { ...receipt(), ...patch }; setupRpc('admin', { [PROCESS]: { data } }); expect(await (await route.POST(post())).json()).toEqual({ data });
    });
    it.each([null, [], {}, { ...receipt(), actor: { userId: OTHER, role: 'admin' } }, { ...receipt(), actor: { userId: ADMIN, role: 'sales' } },
        { ...receipt(), requestId: OTHER }, { ...receipt(), taskId: OTHER }, { ...receipt(), processedAt: `${AT}\n` },
        { ...receipt(), notificationId: NOTICE }, { ...receipt(), withdrawnCount: -1 }])('keeps malformed or wrongscope success%j uncertain', async data => {
        setupRpc('admin', { [PROCESS]: { data } }); await errorResponse(await route.POST(post()), 503, 'UNKNOWN_RESULT', false);
        expect(rpc.mock.calls.filter(call => call[0] === PROCESS)).toHaveLength(1);
    });
    it.each(['getUser', 'crm_v2_role', CAPABILITY])('knows processor was not called after thrown precheck%s', async name => {
        if (name === 'getUser') getUser.mockRejectedValueOnce(new Error('private token=secret'));
        else { const configured = rpc.getMockImplementation()!; rpc.mockImplementation(async key => { if (key === name) throw new Error('private token=secret'); return configured(key); }); }
        await errorResponse(await route.POST(post()), 503, 'PRECHECK_UNAVAILABLE', true); expect(rpc.mock.calls.some(call => call[0] === PROCESS)).toBe(false);
    });
    it('keeps thrown processor transportfailure uncertain and never retries automatically', async () => {
        const configured = rpc.getMockImplementation()!; rpc.mockImplementation(async name => { if (name === PROCESS) throw new Error('private transport'); return configured(name); });
        await errorResponse(await route.POST(post()), 503, 'UNKNOWN_RESULT', false); expect(rpc.mock.calls.filter(call => call[0] === PROCESS)).toHaveLength(1);
    });
    it('uses identical command on explicit retry, preserving database replayreceipt', async () => {
        const first = await route.POST(post()); expect((await first.json()).data.replayed).toBe(false);
        setupRpc('admin', { [PROCESS]: { data: { ...receipt(), replayed: true } } }); const second = await route.POST(post()); expect((await second.json()).data.replayed).toBe(true);
        const calls = rpc.mock.calls.filter(call => call[0] === PROCESS); expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1]);
    });
    it.each([['INVALID_INPUT', 400], ['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['NOT_AVAILABLE', 404], ['IDEMPOTENCY_CONFLICT', 409]])('maps exact transaction abortCRM_SLA_PROCESS_%s', async (code, status) => {
        setupRpc('admin', { [PROCESS]: { error: { code: 'P0001', message: `CRM_SLA_PROCESS_${code}`, details: 'private' } } });
        await errorResponse(await route.POST(post()), Number(status), String(code), true);
    });
    it.each([{ code: 'P0001', message: 'CRM_SLA_PROCESS_FORBIDDEN extra' }, { code: 'XX000', message: 'CRM_SLA_PROCESS_FORBIDDEN' },
        { code: '23505', message: 'private raw SQL' }])('does not infer rollback from unknown processerror%j', async error => {
        setupRpc('admin', { [PROCESS]: { error } }); await errorResponse(await route.POST(post()), 503, 'UNKNOWN_RESULT', false);
    });
    it('classifies unknown precheckRPCerror as notattempted rather than unknowncommit', async () => {
        setupRpc('admin', { [CAPABILITY]: { error: { code: 'XX000', message: 'private' } } }); await errorResponse(await route.POST(post()), 503, 'PRECHECK_UNAVAILABLE', true);
    });
    it.each(['crm_v2_role', CAPABILITY, PROCESS])('fails closed on missing%s without legacyfallback', async name => {
        setupRpc('admin', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } }); await errorResponse(await route.POST(post()), 503, 'SETUP_REQUIRED', true);
    });
});
