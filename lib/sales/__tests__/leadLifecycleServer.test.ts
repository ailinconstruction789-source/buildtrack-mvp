// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn();
    const rpc = vi.fn();
    const from = vi.fn(() => { throw new Error('Direct table access forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import * as route from '@/app/api/sales-crm/lifecycle/route';
const { GET, POST } = route;

const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const REQUEST = '00000000-0000-4000-8000-000000000001';
const ACTION = '00000000-0000-4000-8000-000000000002';
const REVISION = '00000000-0000-4000-8000-000000000003';
const NEXT_REVISION = '00000000-0000-4000-8000-000000000004';
const TARGET = '00000000-0000-4000-8000-000000000005';
const REPLACEMENT_ACTION = '00000000-0000-4000-8000-000000000006';
const TOKEN = 'verified-bearer';
const URL = 'https://app.test/api/sales-crm/lifecycle';
const COMMAND_RPC = 'crm_v2_change_lead_lifecycle';
const CAPABILITY_RPC = 'crm_v2_lead_lifecycle_capabilities';
const READ_RPC = 'crm_v2_lead_lifecycle_context';
const payload = { requestId: REQUEST, command: 'close_lost', customerId: USER, interestId: null,
    expectedRevision: REVISION, expectedActionId: null, reason: 'ลูกค้าไม่สนใจแล้ว' };
const reassignment = { ...payload, command: 'reassign_owner', newOwnerUserId: TARGET };
const success = { revision: NEXT_REVISION, nextActionId: null, replayed: false };

function request(value: unknown = payload, headers: Record<string, string> = {}) {
    return new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

function readRequest(query = `customerId=${USER}`, authorization = `Bearer ${TOKEN}`) {
    return new Request(`${URL}?${query}`, { headers: { authorization } });
}

function context(role: unknown = 'sales', customerId = USER, interestId: string | null = null) {
    return { work: { actor: { userId: USER, role }, scope: { customerId, interestId },
        customer: { id: customerId, name: 'ลูกค้า', phone: null, leadCreatedAt: null },
        projectName: interestId === null ? null : 'โครงการ A', owner: { userId: USER, displayName: null, active: true },
        scopeClosed: false, lifecycleRevision: REVISION, canWrite: role === 'sales' || role === 'admin',
        asOf: '2026-09-16T12:00:00.979649+07:00', currentAction: null, actions: [], activities: [],
        history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } },
    candidates: role === 'admin' ? [{ userId: TARGET, displayName: 'Sales A' }] : [], candidatesTruncated: false,
    canReassign: role === 'admin', canClose: role === 'sales' || role === 'admin',
    blockers: { hasBookingHistory: false, hasOpenInterests: false }, impact: { openSlaCount: 2, pendingNotificationCount: 3 } };
}

function setupRpc(role: unknown = 'sales', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string, args?: { p_customer_id?: string; p_interest_id?: string | null; p_payload?: { command: string; expectedActionId: string | null } }) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY_RPC) return { data: { contract_version: 'lead_lifecycle_v1', read_contract_version: 'lead_lifecycle_read_v1', enabled: true }, error: null };
        if (name === READ_RPC) return { data: context(role, args?.p_customer_id, args?.p_interest_id ?? null), error: null };
        if (name === COMMAND_RPC) return { data: { ...success,
            nextActionId: args?.p_payload?.command === 'reassign_owner' && args.p_payload.expectedActionId !== null ? REPLACEMENT_ACTION : null }, error: null };
        throw new Error('Unexpected RPC');
    });
}

function expectHeaders(response: Response) {
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status); expectHeaders(response);
    const body = await response.json();
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message).not.toMatch(/private|token=secret|raw SQL|customer phone|CRM_LIFECYCLE/);
    return body;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SALES_CRM_V2_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_LIFECYCLE_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
    getUser.mockResolvedValue({ data: { user: { id: USER, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null });
    setupRpc();
});

afterEach(() => {
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY_RPC, COMMAND_RPC, READ_RPC].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});

describe('lifecycle endpoint switches, authentication and roles', () => {
    it('exports only node, uncached GET/POST handlers', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic', 'runtime']);
        expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic');
    });

    for (const flag of ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED']) {
        it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exact true for ${flag}, rejecting %j before body/auth/network`, async value => {
            vi.stubEnv(flag, value);
            const req = request();
            await expectError(await POST(req), 503, 'FEATURE_DISABLED');
            expect(req.bodyUsed).toBe(false);
            expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
        });
    }

    it.each(['', 'Basic secret', 'Bearer ', 'Bearer one two', `Bearer ${'a'.repeat(8193)}`])('rejects malformed authorization %j before client creation', async authorization => {
        await expectError(await POST(request(payload, { authorization })), 401, 'UNAUTHENTICATED');
        expect(createClient).not.toHaveBeenCalled();
    });

    it.each([null, {}, { id: 'bad' }, { id: `${USER}\n` }])('requires a verified real user UUID, rejecting %j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null });
        await expectError(await POST(request()), 401, 'UNAUTHENTICATED');
        expect(getUser).toHaveBeenCalledWith(TOKEN); expect(rpc).not.toHaveBeenCalled();
    });

    it('rejects auth errors even if a user object is supplied', async () => {
        getUser.mockResolvedValue({ data: { user: { id: USER } }, error: { message: 'private token=secret' } });
        await expectError(await POST(request()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });

    it('constructs only the public anon client with caller Authorization and no persistent session', async () => {
        expect((await POST(request())).status).toBe(201);
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: `Bearer ${TOKEN}` } },
        });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY_RPC, COMMAND_RPC]);
    });

    it.each(['owner', null, '', 'super_admin', { role: 'admin' }])('denies %j despite client metadata claiming admin', async role => {
        setupRpc(role);
        await expectError(await POST(request()), 403, 'FORBIDDEN');
        expect(rpc).toHaveBeenCalledExactlyOnceWith('crm_v2_role');
    });

    it('requires Admin for reassignment before capability or command calls', async () => {
        await expectError(await POST(request(reassignment)), 403, 'FORBIDDEN');
        expect(rpc).toHaveBeenCalledExactlyOnceWith('crm_v2_role');
        setupRpc('admin');
        expect((await POST(request(reassignment))).status).toBe(201);
    });

    it.each(['sales', 'admin'])('accepts trusted %s for close, leaving actual current ownership to the RPC', async role => {
        setupRpc(role);
        expect((await POST(request())).status).toBe(201);
        setupRpc(role, { [COMMAND_RPC]: { error: { code: 'P0001', message: 'CRM_LIFECYCLE_FORBIDDEN' } } });
        await expectError(await POST(request()), 403, 'FORBIDDEN');
    });

    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing %s', async name => {
        vi.stubEnv(name, '');
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });

    it.each(['sb_secret_forbidden', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged-key misconfiguration %j', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key);
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });

    it.each(['crm_v2_role', CAPABILITY_RPC, COMMAND_RPC])('reports missing %s as setup required with no fallback', async name => {
        setupRpc('sales', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } });
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED');
    });

    it.each([null, [], {}, { contract_version: 'lead_work_v1', enabled: true }, { contract_version: 'lead_lifecycle_v1', enabled: false }, { contract_version: 'lead_lifecycle_v1', enabled: 'true' }])('rejects missing/incompatible capability %j before command', async data => {
        setupRpc('sales', { [CAPABILITY_RPC]: { data } });
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED'); expect(rpc).toHaveBeenCalledTimes(2);
    });
});

describe('bounded lifecycle command body', () => {
    it.each([payload, reassignment])('forwards only the exact normalized command %j', async value => {
        setupRpc('admin');
        const input = { ...value, customerId: USER.toUpperCase(), interestId: ACTION, expectedActionId: ACTION, reason: '  ลูกค้าขอเปลี่ยนแปลง  ' };
        const response = await POST(request(input)); expect(response.status).toBe(201); expectHeaders(response);
        expect(await response.json()).toEqual({ data: { ...success, nextActionId: value.command === 'reassign_owner' ? REPLACEMENT_ACTION : null } });
        const { requestId, ...expected } = input;
        expect(rpc).toHaveBeenLastCalledWith(COMMAND_RPC, { p_request_id: requestId, p_payload: { ...expected, customerId: USER, reason: 'ลูกค้าขอเปลี่ยนแปลง' } });
    });

    it.each(['actor', 'role', 'ownerUserId', 'status', 'recordedAt', 'dueAt', 'nextAction', 'kpiCredit', 'legacy_source_lead_id'])('rejects injected %s before any network', async field => {
        await expectError(await POST(request({ ...payload, [field]: 'untrusted' })), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects forbidden target-owner injection into close_lost before auth', async () => {
        await expectError(await POST(request({ ...payload, newOwnerUserId: TARGET })), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });

    it.each([null, [], { ...payload, expectedRevision: null }, { ...payload, expectedActionId: '' }, { ...payload, reason: '\ud800' }, { ...payload, reason: '\udfff' }, { ...payload, reason: 'เหตุผล\u0000' }])('rejects malformed data or Unicode %j without auth', async input => {
        await expectError(await POST(request(input)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects non-JSON media, missing body, malformed JSON and invalid UTF-8', async () => {
        await expectError(await POST(request(payload, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
        for (const body of [undefined, '{broken', new Uint8Array([0xff, 0xfe])]) {
            await expectError(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), 400, 'INVALID_INPUT');
        }
        expect(createClient).not.toHaveBeenCalled();
    });

    it('accepts valid split UTF-8 scalars and explicit JSON charset without replacing text', async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, reason: 'เหตุผล 🙏' }));
        const body = new ReadableStream<Uint8Array>({ start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
        } });
        expect((await POST(new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'Application/JSON; charset=utf-8' }, body, duplex: 'half' } as RequestInit))).status).toBe(201);
        expect(rpc).toHaveBeenLastCalledWith(COMMAND_RPC, expect.objectContaining({ p_payload: expect.objectContaining({ reason: 'เหตุผล 🙏' }) }));
    });

    it.each<Record<string, string>>([{}, { 'content-length': '1' }, { 'content-length': 'unknown' }])('measures actual UTF-8 bytes regardless of advertised length %j', async headers => {
        await expectError(await POST(request({ ...payload, reason: 'ก'.repeat(6000) }, headers)), 413, 'PAYLOAD_TOO_LARGE');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects an oversized declared length before body consumption', async () => {
        const req = request(payload, { 'content-length': '16385' });
        await expectError(await POST(req), 413, 'PAYLOAD_TOO_LARGE'); expect(req.bodyUsed).toBe(false); expect(createClient).not.toHaveBeenCalled();
    });

    it('accepts exactly 16 KiB but rejects one extra byte even when JSON itself is short', async () => {
        const value = JSON.stringify(payload);
        const body = value + ' '.repeat(16384 - new TextEncoder().encode(value).byteLength);
        const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
        expect((await POST(new Request(URL, { method: 'POST', headers, body }))).status).toBe(201);
        await expectError(await POST(new Request(URL, { method: 'POST', headers, body: `${body} ` })), 413, 'PAYLOAD_TOO_LARGE');
        expect(createClient).toHaveBeenCalledTimes(1);
    });

    it('cancels an unfinished stream immediately after cumulative bytes exceed the limit', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(new Uint8Array(12000)); controller.enqueue(new Uint8Array(8000));
        }, cancel });
        await expectError(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)), 413, 'PAYLOAD_TOO_LARGE');
        expect(cancel).toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    });
});

describe('safe lifecycle responses and retry semantics (mocked RPC only)', () => {
    it.each([[null, ACTION], [ACTION, null], [ACTION, ACTION]])('leaves contradictory reassignment action expected=%j returned=%j uncertain', async (expectedActionId, nextActionId) => {
        setupRpc('admin', { [COMMAND_RPC]: { data: { ...success, nextActionId } } });
        await expectError(await POST(request({ ...reassignment, expectedActionId })), 503, 'SERVICE_UNAVAILABLE');
    });
    it('returns 201 for a new command and 200 only for an explicitly replayed command', async () => {
        expect((await POST(request())).status).toBe(201);
        setupRpc('sales', { [COMMAND_RPC]: { data: { ...success, replayed: true } } });
        const response = await POST(request()); expect(response.status).toBe(200); expectHeaders(response);
        expect(await response.json()).toEqual({ data: { ...success, replayed: true } });
    });

    it.each([null, ACTION])('accepts reassignment returned action %j without fabricating work', async nextActionId => {
        setupRpc('admin', { [COMMAND_RPC]: { data: { ...success, revision: USER.toUpperCase(), nextActionId, privateDump: 'private raw SQL' } } });
        expect(await (await POST(request({ ...reassignment, expectedActionId: nextActionId === null ? null : REVISION }))).json()).toEqual({ data: { ...success, revision: USER, nextActionId } });
    });

    it('normalizes returned UUIDs and exposes only the result contract', async () => {
        setupRpc('admin', { [COMMAND_RPC]: { data: { revision: USER.toUpperCase(), nextActionId: USER.toUpperCase(), replayed: false, ownerUserId: TARGET } } });
        expect(await (await POST(request({ ...reassignment, expectedActionId: ACTION }))).json()).toEqual({ data: { revision: USER, nextActionId: USER, replayed: false } });
    });

    it.each([null, [], {}, { nextActionId: null, replayed: false }, { ...success, revision: null }, { ...success, revision: `${REVISION}\n` }, { ...success, replayed: 'false' }, { revision: REVISION, replayed: false }, { ...success, nextActionId: ACTION }])('treats invalid close success %j as uncertain', async data => {
        setupRpc('sales', { [COMMAND_RPC]: { data } });
        const body = await expectError(await POST(request()), 503, 'SERVICE_UNAVAILABLE');
        expect(body.error.message).toContain('รหัสคำขอและข้อมูลเดิม');
        expect(rpc.mock.calls.filter(call => call[0] === COMMAND_RPC)).toHaveLength(1);
    });

    it.each([undefined, '', false, 'bad', `${ACTION}\n`])('rejects malformed reassignment action %j as uncertain', async nextActionId => {
        setupRpc('admin', { [COMMAND_RPC]: { data: { ...success, nextActionId } } });
        await expectError(await POST(request(reassignment)), 503, 'SERVICE_UNAVAILABLE');
    });

    it('preserves the same request ID and exact payload across uncertainty and explicit caller retry', async () => {
        setupRpc('admin', { [COMMAND_RPC]: { data: { invalid: true } } });
        await expectError(await POST(request(reassignment)), 503, 'SERVICE_UNAVAILABLE');
        const first = rpc.mock.calls.find(call => call[0] === COMMAND_RPC)?.[1];
        setupRpc('admin', { [COMMAND_RPC]: { data: { ...success, replayed: true } } });
        expect((await POST(request(reassignment))).status).toBe(200);
        const commands = rpc.mock.calls.filter(call => call[0] === COMMAND_RPC);
        expect(commands).toHaveLength(2); expect(commands[1][1]).toEqual(first);
        expect(first).toMatchObject({ p_request_id: REQUEST, p_payload: { expectedRevision: REVISION, expectedActionId: null, newOwnerUserId: TARGET } });
    });

    it.each([
        ['INVALID_INPUT', 400], ['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['NOT_FOUND', 404],
        ['IDEMPOTENCY_CONFLICT', 409], ['STALE_SCOPE', 409], ['STALE_ACTION', 409], ['SCOPE_CLOSED', 409],
        ['INACTIVE_TARGET', 409], ['BOOKING_HISTORY_EXISTS', 409], ['OPEN_INTERESTS', 409], ['UNCHANGED_OWNER', 409],
    ])('maps the exact lifecycle marker %s without private diagnostics', async (code, status) => {
        setupRpc('sales', { [COMMAND_RPC]: { error: { code: 'P0001', message: `CRM_LIFECYCLE_${code}`, details: 'private raw SQL and customer phone' } } });
        await expectError(await POST(request()), Number(status), String(code));
    });

    it.each(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])('maps missing schema/RPC code %s to setup without fallback', async code => {
        setupRpc('sales', { [COMMAND_RPC]: { error: { code, message: 'private raw SQL' } } });
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED');
    });

    it.each([['42501', 403, 'FORBIDDEN'], ['PGRST301', 401, 'UNAUTHENTICATED'], ['PGRST302', 401, 'UNAUTHENTICATED'], ['PGRST303', 401, 'UNAUTHENTICATED']])('maps known access code %s safely', async (sqlCode, status, code) => {
        setupRpc('sales', { [COMMAND_RPC]: { error: { code: sqlCode, message: 'private token=secret' } } });
        await expectError(await POST(request()), Number(status), String(code));
    });

    it.each([
        { code: 'XX000', message: 'private raw SQL' }, { code: '23505', message: 'private unique constraint' },
        { code: '22023', message: 'private raw SQL' }, { code: 'P0001', message: 'CRM_LIFECYCLE_FORBIDDEN private detail' },
        { code: 'XX000', message: 'CRM_LIFECYCLE_FORBIDDEN' }, { code: 'P0001', message: 'CRM_WORK_STALE_ACTION' }, {}, 'error',
    ])('leaves unknown or near-match RPC errors %j uncertain instead of asserting no write', async error => {
        setupRpc('sales', { [COMMAND_RPC]: { error } });
        const body = await expectError(await POST(request()), 503, 'SERVICE_UNAVAILABLE');
        expect(body.error.message).toContain('รหัสคำขอและข้อมูลเดิม');
    });

    it('sanitizes unexpected throws and never automatically retries the command', async () => {
        rpc.mockImplementation(async (name: string) => {
            if (name === 'crm_v2_role') return { data: 'sales', error: null };
            if (name === CAPABILITY_RPC) return { data: { contract_version: 'lead_lifecycle_v1', enabled: true }, error: null };
            throw new Error('private token=secret and customer phone');
        });
        await expectError(await POST(request()), 503, 'SERVICE_UNAVAILABLE');
        expect(rpc.mock.calls.filter(call => call[0] === COMMAND_RPC)).toHaveLength(1);
    });
});

describe('lifecycle read context adapter (mocked RPC only)', () => {
    it.each([['INVALID_INPUT', 400], ['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['NOT_FOUND', 404]])('maps shared-reader CRM_WORK_%s only on GET, never POST', async (code, status) => {
        const error = { code: 'P0001', message: `CRM_WORK_${code}`, details: 'private raw SQL' };
        setupRpc('sales', { [READ_RPC]: { error }, [COMMAND_RPC]: { error } });
        await expectError(await GET(readRequest()), Number(status), String(code));
        await expectError(await POST(request()), 503, 'SERVICE_UNAVAILABLE');
    });

    it.each([
        { code: 'XX000', message: 'CRM_WORK_NOT_FOUND' },
        { code: 'P0001', message: 'CRM_WORK_NOT_FOUND private detail' },
        { code: 'P0001', message: 'CRM_WORK_IDEMPOTENCY_CONFLICT' },
    ])('does not broaden the read marker allowlist for %j', async error => {
        setupRpc('sales', { [READ_RPC]: { error } });
        const body = await expectError(await GET(readRequest()), 503, 'READ_UNAVAILABLE');
        expect(body.error.message).not.toContain('รหัสคำขอ');
    });
    it.each(['sales', 'admin', 'owner'])('allows verified active %s read with strict actor and scope binding', async role => {
        setupRpc(role);
        const response = await GET(readRequest(`customerId=${USER.toUpperCase()}&interestId=${ACTION}`));
        expect(response.status).toBe(200); expectHeaders(response);
        expect(await response.json()).toEqual({ data: context(role, USER, ACTION) });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY_RPC, READ_RPC]);
        expect(rpc).toHaveBeenLastCalledWith(READ_RPC, { p_customer_id: USER, p_interest_id: ACTION });
        expect(getUser).toHaveBeenCalledExactlyOnceWith(TOKEN);
    });

    it('passes explicit null for central scope and never invokes a mutation RPC', async () => {
        expect((await GET(readRequest())).status).toBe(200);
        expect(rpc).toHaveBeenLastCalledWith(READ_RPC, { p_customer_id: USER, p_interest_id: null });
        expect(rpc.mock.calls.some(call => call[0] === COMMAND_RPC)).toBe(false);
    });

    it.each(['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED'])('blocks disabled %s before client/auth/RPC', async name => {
        vi.stubEnv(name, 'false');
        await expectError(await GET(readRequest()), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });

    it.each(['', 'customerId=', 'customerId=bad', `customerId=${USER}&customerId=${USER}`,
        `customerId=${USER}&interestId=`, `customerId=${USER}&interestId=${ACTION}&interestId=${ACTION}`,
        `customerId=${USER}&role=admin`, `customerId=${USER}&customerId=${ACTION}`, `customerId=${USER}%0A`])('rejects scope query %j before network', async query => {
        await expectError(await GET(readRequest(query)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });

    it('requires bearer auth and rejects getUser errors without role lookup', async () => {
        await expectError(await GET(readRequest(undefined, '')), 401, 'UNAUTHENTICATED'); expect(createClient).not.toHaveBeenCalled();
        getUser.mockResolvedValue({ data: { user: null }, error: { message: 'private token=secret' } });
        await expectError(await GET(readRequest()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });

    it.each([null, '', 'super_admin', { role: 'admin' }])('ignores browser metadata and denies role %j', async role => {
        setupRpc(role);
        await expectError(await GET(readRequest()), 403, 'FORBIDDEN'); expect(rpc).toHaveBeenCalledTimes(1);
    });

    it.each(['crm_v2_role', CAPABILITY_RPC, READ_RPC])('fails closed without fallback when %s is missing', async name => {
        setupRpc('sales', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
        expect(rpc.mock.calls.some(call => call[0] === COMMAND_RPC)).toBe(false);
    });

    it.each([undefined, 'lead_lifecycle_read_v0', true])('requires exact read version %j while preserving the existing POST gate', async read_contract_version => {
        setupRpc('sales', { [CAPABILITY_RPC]: { data: { contract_version: 'lead_lifecycle_v1', enabled: true, read_contract_version } } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
        expect((await POST(request())).status).toBe(201);
    });

    it('allows Owner read without enabling either Owner write command', async () => {
        setupRpc('owner'); expect((await GET(readRequest())).status).toBe(200);
        await expectError(await POST(request()), 403, 'FORBIDDEN');
        await expectError(await POST(request(reassignment)), 403, 'FORBIDDEN');
        expect(rpc.mock.calls.some(call => call[0] === COMMAND_RPC)).toBe(false);
    });

    it('projects only the context contract, including nullable legacy phone', async () => {
        const data = context('admin');
        setupRpc('admin', { [READ_RPC]: { data: { ...data, privateDump: 'secret', candidates: [{ ...data.candidates[0], personalData: 'hidden' }] } } });
        expect(await (await GET(readRequest())).json()).toEqual({ data });
    });

    it.each(['actorId', 'actorRole', 'scope', 'rights', 'counts', 'legacyVersion'])('rejects contradictory read %s instead of exposing or trusting it', async field => {
        const data = context('admin');
        if (field === 'actorId') data.work.actor.userId = TARGET;
        if (field === 'actorRole') { data.work.actor.role = 'sales'; data.canReassign = false; data.candidates = []; }
        if (field === 'scope') { data.work.scope.customerId = TARGET; data.work.customer.id = TARGET; }
        if (field === 'rights') data.canReassign = false;
        if (field === 'counts') data.impact.openSlaCount = -1;
        if (field === 'legacyVersion') delete (data.work as Partial<typeof data.work>).lifecycleRevision;
        setupRpc('admin', { [READ_RPC]: { data } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
    });

    it.each([
        { code: 'XX000', message: 'private raw SQL' },
        { code: 'P0001', message: 'CRM_LIFECYCLE_IDEMPOTENCY_CONFLICT' },
        { code: 'P0001', message: 'CRM_LIFECYCLE_STALE_ACTION' },
    ])('returns read-only wording for unexpected read errors %j', async error => {
        setupRpc('sales', { [READ_RPC]: { error } });
        const body = await expectError(await GET(readRequest()), 503, 'READ_UNAVAILABLE');
        expect(body.error.message).not.toMatch(/รหัสคำขอ|ผลบันทึก|ผลการบันทึก/);
    });

    it('sanitizes thrown read failures without retry or write uncertainty', async () => {
        rpc.mockRejectedValue(new Error('private token=secret'));
        const body = await expectError(await GET(readRequest()), 503, 'READ_UNAVAILABLE');
        expect(body.error.message).not.toContain('รหัสคำขอ'); expect(rpc).toHaveBeenCalledTimes(1);
    });
});
