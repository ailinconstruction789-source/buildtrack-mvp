// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn();
    const rpc = vi.fn();
    const from = vi.fn(() => { throw new Error('Direct table access forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { GET, POST } from '@/app/api/sales-crm/lead-work/route';

const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const REQUEST = '00000000-0000-4000-8000-000000000001';
const ACTION = '00000000-0000-4000-8000-000000000002';
const ACTIVITY = '00000000-0000-4000-8000-000000000003';
const TOKEN = 'verified-bearer';
const URL = 'https://app.test/api/sales-crm/lead-work';
const payload = {
    requestId: REQUEST, command: 'set_next_action', customerId: USER, interestId: null, expectedActionId: null,
    nextAction: { action: 'โทรติดตาม', dueAt: '2026-09-16T15:00:00.979649+07:00' }, reason: 'ลูกค้าขอนัดติดตาม',
};
const attemptPayload = { ...payload, command: 'record_attempt', attempt: {
    action: 'โทรสอบถาม', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-16T10:00:00.123456+07:00',
} };

function request(value: unknown = payload, headers: Record<string, string> = {}) {
    return new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

function readRequest(query = `customerId=${USER}`) {
    return new Request(`${URL}?${query}`, { headers: { authorization: `Bearer ${TOKEN}` } });
}

function readSnapshot(role: unknown = 'sales', customerId = USER, interestId: string | null = null) {
    return { actor: { userId: USER, role }, scope: { customerId, interestId }, customer: { id: customerId, name: 'ลูกค้า', phone: null, leadCreatedAt: null },
        projectName: interestId === null ? null : 'โครงการ A', owner: { userId: USER, displayName: 'ฝ่ายขาย', active: true }, scopeClosed: false, lifecycleRevision: USER, canWrite: role !== 'owner',
        asOf: '2026-09-16T12:00:00.979649+07:00', currentAction: null, actions: [], activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } };
}

function setupRpc(role: unknown = 'sales', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string, args?: { p_payload?: { command: string }; p_customer_id?: string; p_interest_id?: string | null }) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === 'crm_v2_lead_work_capabilities') return { data: { contract_version: 'lead_work_v1', read_contract_version: 'lead_work_read_v2', enabled: true }, error: null };
        if (name === 'crm_v2_lead_work_snapshot') return { data: readSnapshot(role, args?.p_customer_id, args?.p_interest_id ?? null), error: null };
        if (name === 'crm_v2_record_lead_work') return { data: { nextActionId: ACTION, activityId: args?.p_payload?.command === 'record_attempt' ? ACTIVITY : null, replayed: false }, error: null };
        throw new Error('Unexpected RPC');
    });
}

async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toMatchObject({ error: { code, message: expect.any(String) } });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SALES_CRM_V2_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
    getUser.mockResolvedValue({ data: { user: { id: USER, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null });
    setupRpc();
});

describe('lead work read adapter', () => {
    it.each(['sales', 'admin', 'owner'])('allows verified %s read and binds identity/scope without any mutation RPC', async role => {
        setupRpc(role);
        const response = await GET(readRequest(`customerId=${USER.toUpperCase()}&interestId=${ACTION}`));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('vary')).toBe('Authorization');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await response.json()).toEqual({ data: readSnapshot(role, USER, ACTION) });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_lead_work_capabilities', 'crm_v2_lead_work_snapshot']);
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_lead_work_snapshot', { p_customer_id: USER, p_interest_id: ACTION });
    });
    it('uses explicit null interest for central work', async () => {
        expect((await GET(readRequest())).status).toBe(200);
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_lead_work_snapshot', { p_customer_id: USER, p_interest_id: null });
    });
    it.each(['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED'])('requires %s before any read network call', async flag => {
        vi.stubEnv(flag, 'false');
        await expectError(await GET(readRequest()), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });
    it.each([`customerId=${USER}&page=1`, `customerId=${USER}&customerId=${USER}`, `customerId=${USER}&interestId=`, 'customerId=bad'])('rejects malformed scope query %s before auth', async query => {
        await expectError(await GET(readRequest(query)), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });
    it('requires verified read identity and ignores admin metadata', async () => {
        getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
        await expectError(await GET(readRequest()), 401, 'UNAUTHENTICATED');
        expect(rpc).not.toHaveBeenCalled();
    });
    it('requires read contract capability but does not change the older write contract gate', async () => {
        setupRpc('sales', { crm_v2_lead_work_capabilities: { data: { contract_version: 'lead_work_v1', enabled: true } } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
        expect((await POST(request())).status).toBe(201);
    });
    it('retains the Owner write denial even though read is allowed', async () => {
        setupRpc('owner');
        expect((await GET(readRequest())).status).toBe(200);
        await expectError(await POST(request()), 403, 'FORBIDDEN');
        expect(rpc.mock.calls.some(call => call[0] === 'crm_v2_record_lead_work')).toBe(false);
    });
    it('rejects mismatched returned actor or requested scope', async () => {
        setupRpc('sales', { crm_v2_lead_work_snapshot: { data: { ...readSnapshot(), actor: { userId: ACTION, role: 'sales' }, canWrite: false } } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
        setupRpc('sales', { crm_v2_lead_work_snapshot: { data: readSnapshot('sales', ACTION) } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
    });
    it('does not convert corrupt or missing setup into an empty history', async () => {
        setupRpc('sales', { crm_v2_lead_work_snapshot: { data: [] } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
        setupRpc('sales', { crm_v2_lead_work_snapshot: { error: { code: 'PGRST202', message: 'missing RPC' } } });
        await expectError(await GET(readRequest()), 503, 'SETUP_REQUIRED');
    });
    it('reports safe read errors without implying a write may have occurred', async () => {
        setupRpc('sales', { crm_v2_lead_work_snapshot: { error: { code: 'XX000', message: 'private SQL or phone' } } });
        const response = await GET(readRequest()); const body = await response.json();
        expect(response.status).toBe(503); expect(body.error.code).toBe('READ_UNAVAILABLE');
        expect(body.error.message).not.toMatch(/private|SQL|phone|ผลการบันทึก|รหัสคำขอ/);
    });
});

afterEach(() => {
    expect(from).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
});

describe('lead work feature and authentication boundary', () => {
    it.each([
        ['', 'true'], ['true', ''], ['false', 'true'], ['true', 'false'], ['TRUE', 'true'], ['true', '1'], ['', ''],
    ])('blocks before any client call when central=%j and lead-work=%j', async (central, work) => {
        vi.stubEnv('SALES_CRM_V2_ENABLED', central); vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', work);
        await expectError(await POST(request()), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });

    it.each(['', 'Basic secret', 'Bearer ', 'Bearer one two'])('rejects missing/invalid authorization %j', async authorization => {
        await expectError(await POST(request(payload, { authorization })), 401, 'UNAUTHENTICATED');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects an unverified bearer before any RPC', async () => {
        getUser.mockResolvedValue({ data: { user: null }, error: { message: 'secret auth diagnostic' } });
        await expectError(await POST(request()), 401, 'UNAUTHENTICATED');
        expect(getUser).toHaveBeenCalledWith(TOKEN); expect(rpc).not.toHaveBeenCalled();
    });

    it('uses only an anon per-request client with caller Authorization and trusted active-role lookup', async () => {
        expect((await POST(request())).status).toBe(201);
        expect(createClient).toHaveBeenCalledWith('https://supabase.test', 'public-anon-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: `Bearer ${TOKEN}` } },
        });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_lead_work_capabilities', 'crm_v2_record_lead_work']);
    });

    it.each(['owner', null, '', 'super_admin', { role: 'sales' }])('denies role %j despite metadata admin hints', async role => {
        setupRpc(role);
        await expectError(await POST(request()), 403, 'FORBIDDEN');
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed when %s is missing', async field => {
        vi.stubEnv(field, '');
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED');
        expect(createClient).not.toHaveBeenCalled();
    });

    it.each(['sb_secret_forbidden', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged key misconfiguration', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key);
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED');
        expect(createClient).not.toHaveBeenCalled();
    });

    it.each(['crm_v2_role', 'crm_v2_lead_work_capabilities', 'crm_v2_record_lead_work'])('reports a missing %s as setup required without fallback', async name => {
        setupRpc('sales', { [name]: { error: { code: 'PGRST202', message: 'private SQL detail' } } });
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED');
        expect(rpc.mock.calls.every(call => ['crm_v2_role', 'crm_v2_lead_work_capabilities', 'crm_v2_record_lead_work'].includes(String(call[0])))).toBe(true);
    });

    it.each([null, {}, { contract_version: 'central_intake_v1', enabled: true }, { contract_version: 'lead_work_v1', enabled: false }, { contract_version: 'lead_work_v1', enabled: 'true' }])('rejects unavailable/incompatible capabilities %j', async data => {
        setupRpc('sales', { crm_v2_lead_work_capabilities: { data } });
        await expectError(await POST(request()), 503, 'SETUP_REQUIRED');
        expect(rpc).toHaveBeenCalledTimes(2);
    });
});

describe('lead work request body and command forwarding', () => {
    it.each(['sales', 'admin'])('allows trusted %s through the adapter but leaves ownership/expected-action checks to SQL', async role => {
        setupRpc(role);
        const response = await POST(request({ ...payload, expectedActionId: ACTION }));
        expect(response.status).toBe(201);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ data: { nextActionId: ACTION, activityId: null, replayed: false } });
        const { requestId, ...expected } = payload;
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_record_lead_work', { p_request_id: requestId, p_payload: { ...expected, expectedActionId: ACTION } });
    });

    it('forwards complete attempt and next action atomically, without adding actor, role, status, or timestamps', async () => {
        const response = await POST(request(attemptPayload));
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ data: { nextActionId: ACTION, activityId: ACTIVITY, replayed: false } });
        const { requestId, ...expected } = attemptPayload;
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_record_lead_work', { p_request_id: requestId, p_payload: expected });
    });

    it('normalizes UUID case but does not truncate microseconds or decide DB current-time validity', async () => {
        const value = { ...attemptPayload, customerId: USER.toUpperCase(), attempt: { ...attemptPayload.attempt, occurredAt: '2099-01-01T01:02:03.000001+07:00' } };
        expect((await POST(request(value))).status).toBe(201);
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_record_lead_work', expect.objectContaining({ p_payload: expect.objectContaining({
            customerId: USER, attempt: { ...attemptPayload.attempt, occurredAt: value.attempt.occurredAt },
        }) }));
    });

    it.each(['ownerUserId', 'actor', 'role', 'status', 'qualified', 'kpiCredit'])('rejects injected %s before any network', async field => {
        await expectError(await POST(request({ ...payload, [field]: 'untrusted' })), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects non-JSON media, broken JSON, and malformed UTF-8 without network', async () => {
        await expectError(await POST(request(payload, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
        await expectError(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' })), 400, 'INVALID_INPUT');
        await expectError(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xff, 0xfe]) })), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('enforces actual UTF-8 byte size even without or with a forged Content-Length', async () => {
        const oversized = { ...payload, reason: 'ก'.repeat(6000) };
        await expectError(await POST(request(oversized)), 413, 'PAYLOAD_TOO_LARGE');
        await expectError(await POST(request(oversized, { 'content-length': '1' })), 413, 'PAYLOAD_TOO_LARGE');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('stops and cancels a chunked stream when cumulative bytes exceed 16 KB', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(new Uint8Array(12000)); controller.enqueue(new Uint8Array(8000));
        }, cancel });
        await expectError(await POST(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)), 413, 'PAYLOAD_TOO_LARGE');
        expect(cancel).toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    });
});

describe('safe result handling and duplicate retry', () => {
    it('returns 200 only for an explicitly replayed valid result', async () => {
        setupRpc('sales', { crm_v2_record_lead_work: { data: { nextActionId: ACTION, activityId: null, replayed: true } } });
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { nextActionId: ACTION, activityId: null, replayed: true } });
    });

    it.each([
        null, [], {}, { nextActionId: 'bad', activityId: null, replayed: false },
        { nextActionId: ACTION, replayed: false }, { nextActionId: ACTION, activityId: null, replayed: 'false' },
        { nextActionId: ACTION, activityId: ACTIVITY, replayed: false },
        { nextActionId: `${ACTION}\n`, activityId: null, replayed: false },
    ])('treats malformed/incompatible set-next-action result %j as uncertain, not unsaved', async data => {
        setupRpc('sales', { crm_v2_record_lead_work: { data } });
        const response = await POST(request());
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
        expect(body.error.message).toContain('รหัสคำขอและข้อมูลเดิม');
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it.each([null, `${ACTIVITY}\n`])('requires a strict activityId for record_attempt, rejecting %j', async activityId => {
        setupRpc('sales', { crm_v2_record_lead_work: { data: { nextActionId: ACTION, activityId, replayed: false } } });
        await expectError(await POST(request(attemptPayload)), 503, 'SERVICE_UNAVAILABLE');
    });

    it('preserves exact request identity across an uncertain result and a caller-initiated replay', async () => {
        setupRpc('sales', { crm_v2_record_lead_work: { data: { id: ACTION } } });
        await expectError(await POST(request()), 503, 'SERVICE_UNAVAILABLE');
        const firstArgs = rpc.mock.calls.find(call => call[0] === 'crm_v2_record_lead_work')?.[1];
        setupRpc('sales', { crm_v2_record_lead_work: { data: { nextActionId: ACTION, activityId: null, replayed: true } } });
        expect((await POST(request())).status).toBe(200);
        const calls = rpc.mock.calls.filter(call => call[0] === 'crm_v2_record_lead_work');
        expect(calls).toHaveLength(2);
        expect(calls[1][1]).toEqual(firstArgs);
        expect(firstArgs).toMatchObject({ p_request_id: REQUEST });
    });

    it.each([
        ['CRM_WORK_INVALID_INPUT', 400, 'INVALID_INPUT'], ['CRM_WORK_TIME_INVALID', 400, 'TIME_INVALID'],
        ['CRM_WORK_STALE_ACTION', 409, 'STALE_ACTION'], ['CRM_WORK_FORBIDDEN', 403, 'FORBIDDEN'],
        ['CRM_WORK_SETUP_REQUIRED', 503, 'SETUP_REQUIRED'], ['CRM_WORK_NOT_FOUND', 404, 'NOT_FOUND'],
        ['CRM_WORK_IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'], ['CRM_WORK_SCOPE_CLOSED', 409, 'SCOPE_CLOSED'],
        ['CRM_WORK_INACTIVE_OWNER', 409, 'INACTIVE_OWNER'],
    ])('maps stable SQL marker %s without exposing details', async (message, status, code) => {
        setupRpc('sales', { crm_v2_record_lead_work: { error: { code: 'P0001', message, details: 'private customer data' } } });
        await expectError(await POST(request()), Number(status), String(code));
    });

    it.each([
        ['23505', 409, 'CONFLICT'], ['22023', 400, 'INVALID_INPUT'], ['22P02', 400, 'INVALID_INPUT'],
        ['42501', 403, 'FORBIDDEN'], ['PGRST301', 401, 'UNAUTHENTICATED'], ['XX000', 503, 'SERVICE_UNAVAILABLE'],
    ])('maps generic SQL code %s safely', async (sqlCode, status, code) => {
        setupRpc('sales', { crm_v2_record_lead_work: { error: { code: sqlCode, message: 'raw SQL, phone and token' } } });
        await expectError(await POST(request()), Number(status), String(code));
    });

    it('does not expose thrown diagnostics or attempt automatic mutation retries', async () => {
        rpc.mockImplementation(async (name: string) => {
            if (name === 'crm_v2_role') return { data: 'sales', error: null };
            if (name === 'crm_v2_lead_work_capabilities') return { data: { contract_version: 'lead_work_v1', enabled: true }, error: null };
            throw new Error('private token=secret and customer phone');
        });
        const response = await POST(request());
        expect(response.status).toBe(503);
        expect(await response.text()).not.toMatch(/private|token=secret|customer phone/);
        expect(rpc.mock.calls.filter(call => call[0] === 'crm_v2_record_lead_work')).toHaveLength(1);
    });

    it('projects only the result contract and never forwards unexpected database fields', async () => {
        setupRpc('sales', { crm_v2_record_lead_work: { data: { nextActionId: ACTION, activityId: null, replayed: false, privateDump: 'secret' } } });
        expect(await (await POST(request())).json()).toEqual({ data: { nextActionId: ACTION, activityId: null, replayed: false } });
    });
});
