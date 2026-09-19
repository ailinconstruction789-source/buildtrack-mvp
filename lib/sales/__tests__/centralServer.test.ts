// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn();
    const rpc = vi.fn();
    const from = vi.fn(() => { throw new Error('Legacy table access is forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { GET, POST } from '@/app/api/sales-crm/central/route';
import type { CrmRole } from '../centralContracts';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const INTEREST = '00000000-0000-4000-8000-000000000004';
const REQUEST = '00000000-0000-4000-8000-000000000005';
const URL = 'https://app.test/api/sales-crm/central';
const TOKEN = 'verified-user-token';
const payload = { requestId: REQUEST, name: 'ลูกค้า', phone: '0812345678', channel: 'โทร', notes: '', interests: [] };

function getRequest(query = '', authorization: string | null = `Bearer ${TOKEN}`) {
    return new Request(`${URL}${query}`, { headers: authorization ? { authorization } : {} });
}

function postRequest(value: unknown = payload, headers: Record<string, string> = {}) {
    return new Request(URL, {
        method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(value),
    });
}

function snapshot(role: CrmRole = 'sales', page = 0) {
    return {
        actor: { userId: USER, role }, projects: [{ name: 'โครงการ A' }], salesOwners: [{ userId: USER, displayName: 'Sales A' }],
        customers: [{
            id: CUSTOMER, name: 'ลูกค้า', phone: '0812345678', channel: null, notes: null, ownerUserId: USER,
            leadCreatedAt: '2026-09-15T09:00:00Z', intakeStatus: 'new',
            interests: [{ id: INTEREST, projectName: 'โครงการ A', ownerUserId: USER, workspaceState: 'central_interest', engagementStatus: 'new', plotId: 'โครงการ A-1' }],
        }], page, hasMore: false,
    };
}

function setupRpc(role: unknown = 'sales', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string, args?: { p_page?: number }) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === 'crm_v2_capabilities') return { data: { contract_version: 'central_intake_v1', enabled: true }, error: null };
        if (name === 'crm_v2_central_snapshot') return { data: snapshot(role as CrmRole, args?.p_page), error: null };
        if (name === 'crm_v2_create_customer') return { data: { customerId: CUSTOMER, replayed: false }, error: null };
        throw new Error('Unexpected RPC');
    });
}

async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(await response.json()).toMatchObject({ error: { code, message: expect.any(String) } });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SALES_CRM_V2_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    getUser.mockResolvedValue({ data: { user: { id: USER, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null });
    setupRpc();
});

afterEach(() => {
    expect(from).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
});

describe('server-only feature, identity, and migration gates', () => {
    it.each(['', 'false', 'TRUE', '1'])('makes zero client or network calls while feature flag is %j', async flag => {
        vi.stubEnv('SALES_CRM_V2_ENABLED', flag);
        await expectError(await GET(getRequest()), 503, 'FEATURE_DISABLED');
        await expectError(await POST(postRequest()), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled();
        expect(getUser).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
    });

    it.each([null, 'Basic password', 'Bearer ', 'Bearer abc def'])('requires a bearer token: %j', async authorization => {
        await expectError(await GET(getRequest('', authorization)), 401, 'UNAUTHENTICATED');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects expired/unverified tokens before any database RPC', async () => {
        getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt diagnostic secret' } });
        await expectError(await GET(getRequest()), 401, 'UNAUTHENTICATED');
        expect(getUser).toHaveBeenCalledWith(TOKEN);
        expect(rpc).not.toHaveBeenCalled();
    });

    it('uses per-request anon client with verified bearer identity and no persisted session', async () => {
        await GET(getRequest());
        expect(createClient).toHaveBeenCalledWith('https://supabase.test', 'test-anon-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: `Bearer ${TOKEN}` } },
        });
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_capabilities', 'crm_v2_central_snapshot']);
    });

    it.each([null, '', 'super_admin', { role: 'sales' }])('ignores both metadata role hints and rejects unmapped trusted role %j', async role => {
        setupRpc(role);
        await expectError(await GET(getRequest()), 403, 'FORBIDDEN');
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it.each(['crm_v2_role', 'crm_v2_capabilities', 'crm_v2_central_snapshot'])('reports missing %s as setup required without falling back', async name => {
        setupRpc('sales', { [name]: { error: { code: 'PGRST202', message: 'private schema diagnostic' } } });
        await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
        expect(rpc.mock.calls.every(call => String(call[0]).startsWith('crm_v2_'))).toBe(true);
    });

    it.each([null, {}, { contract_version: 'old', enabled: true }, { contract_version: 'central_intake_v1', enabled: false }, { contract_version: 'central_intake_v1', enabled: 'true' }])(
        'fails closed on unavailable capability %j', async data => {
            setupRpc('sales', { crm_v2_capabilities: { data } });
            await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
            expect(rpc).toHaveBeenCalledTimes(2);
        },
    );

    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing %s', async name => {
        vi.stubEnv(name, '');
        await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
        expect(createClient).not.toHaveBeenCalled();
    });

    it.each(['sb_secret_never-use', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])(
        'rejects an accidentally configured privileged key', async key => {
            vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key);
            await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
            expect(createClient).not.toHaveBeenCalled();
        },
    );

    it('never sends diagnostics or exception content to the client', async () => {
        getUser.mockRejectedValue(new Error('private URL token=secret'));
        const response = await GET(getRequest());
        expect(response.status).toBe(503);
        expect(await response.text()).not.toMatch(/private|token=|secret/);
    });
});

describe('central snapshot contract', () => {
    it.each(['sales', 'admin', 'owner'] as const)('allows %s to read all project data', async role => {
        setupRpc(role);
        const response = await GET(getRequest('?page=2'));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ data: snapshot(role, 2) });
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_central_snapshot', { p_page: 2, p_page_size: 50 });
    });

    it('validates pagination before constructing a client', async () => {
        await expectError(await GET(getRequest('?page=1e3')), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('does not mistake a missing/malformed schema response for an empty lead list', async () => {
        setupRpc('sales', { crm_v2_central_snapshot: { data: [] } });
        await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
    });

    it('rejects a snapshot from a different actor', async () => {
        setupRpc('sales', { crm_v2_central_snapshot: { data: { ...snapshot(), actor: { userId: OTHER, role: 'sales' } } } });
        await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
    });

    it('projects only contracted fields, excluding future private data', async () => {
        const data = snapshot();
        setupRpc('sales', { crm_v2_central_snapshot: { data: { ...data, privateDump: 'secret', customers: data.customers.map(c => ({ ...c, income: 'secret' })) } } });
        const response = await GET(getRequest());
        expect(await response.json()).toEqual({ data });
    });

    it('preserves an explicit null phone for historical customers instead of inventing a value', async () => {
        const original = snapshot();
        const data = { ...original, customers: original.customers.map(customer => ({ ...customer, phone: null })) };
        setupRpc('sales', { crm_v2_central_snapshot: { data } });
        const response = await GET(getRequest());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data });
    });

    it.each([undefined, 812345678, false, {}, []])('rejects missing or non-string/non-null snapshot phone %j', async phone => {
        const original = snapshot();
        // JSON serialization removes an undefined field, reproducing an absent RPC key.
        const data = JSON.parse(JSON.stringify({ ...original, customers: original.customers.map(customer => ({ ...customer, phone })) }));
        setupRpc('sales', { crm_v2_central_snapshot: { data } });
        await expectError(await GET(getRequest()), 503, 'SETUP_REQUIRED');
    });
});

describe('central creation boundary', () => {
    it('creates a Sales-owned customer without accepting owner fields or touching legacy tables', async () => {
        const response = await POST(postRequest());
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ data: { customerId: CUSTOMER, replayed: false } });
        const { requestId, ...expected } = payload;
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_create_customer', { p_request_id: requestId, p_payload: expected });
    });

    it('returns 200 for an idempotent replay', async () => {
        setupRpc('sales', { crm_v2_create_customer: { data: { customerId: CUSTOMER, replayed: true } } });
        const response = await POST(postRequest());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { customerId: CUSTOMER, replayed: true } });
    });

    it('prevents Owner role from creating even with admin metadata', async () => {
        setupRpc('owner');
        await expectError(await POST(postRequest()), 403, 'FORBIDDEN');
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it.each([USER, OTHER])('Sales cannot set assignedSalesUserId even for %s', async assignedSalesUserId => {
        await expectError(await POST(postRequest({ ...payload, assignedSalesUserId })), 403, 'FORBIDDEN');
        expect(rpc.mock.calls.some(call => call[0] === 'crm_v2_create_customer')).toBe(false);
    });

    it('requires an Admin to explicitly choose a Sales caretaker', async () => {
        setupRpc('admin');
        await expectError(await POST(postRequest()), 400, 'SALES_OWNER_REQUIRED');
        expect(rpc.mock.calls.some(call => call[0] === 'crm_v2_create_customer')).toBe(false);
    });

    it('passes Admin assignment to the RPC for trusted Sales membership validation', async () => {
        setupRpc('admin');
        const response = await POST(postRequest({ ...payload, assignedSalesUserId: OTHER }));
        expect(response.status).toBe(201);
        expect(rpc).toHaveBeenLastCalledWith('crm_v2_create_customer', expect.objectContaining({ p_payload: expect.objectContaining({ assignedSalesUserId: OTHER }) }));
    });

    it('rejects injected ownership fields before any network', async () => {
        await expectError(await POST(postRequest({ ...payload, ownerUserId: OTHER })), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });

    describe.each(['sales', 'admin'] as const)('%s live intake remains strict', role => {
        it.each([null, '', '   ', undefined])('rejects phone %j before any write', async phone => {
            setupRpc(role);
            const assigned = role === 'admin' ? { assignedSalesUserId: OTHER } : {};
            await expectError(await POST(postRequest({ ...payload, ...assigned, phone })), 400, 'INVALID_INPUT');
            expect(createClient).not.toHaveBeenCalled();
            expect(rpc).not.toHaveBeenCalled();
        });

        it.each(['legacyLeadId', 'record_origin', 'recordOrigin', 'phone_data_status', 'phoneDataStatus', 'legacy_source_lead_id', 'legacySourceLeadId', 'intakeStatus'])(
            'cannot inject legacy-only field %s even with a valid phone', async field => {
                setupRpc(role);
                const assigned = role === 'admin' ? { assignedSalesUserId: OTHER } : {};
                await expectError(await POST(postRequest({ ...payload, ...assigned, [field]: 'legacy_import' })), 400, 'INVALID_INPUT');
                expect(createClient).not.toHaveBeenCalled();
                expect(rpc).not.toHaveBeenCalled();
            },
        );
    });

    it('rejects non-JSON media and malformed JSON', async () => {
        await expectError(await POST(postRequest(payload, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
        const request = new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
        await expectError(await POST(request), 400, 'INVALID_INPUT');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('enforces actual UTF-8 byte size when Content-Length is absent or forged', async () => {
        const large = { ...payload, notes: 'ก'.repeat(6000) };
        await expectError(await POST(postRequest(large)), 413, 'PAYLOAD_TOO_LARGE');
        await expectError(await POST(postRequest(large, { 'content-length': '1' })), 413, 'PAYLOAD_TOO_LARGE');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('cancels a streaming request once its cumulative bytes exceed the limit', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(12000)); controller.enqueue(new Uint8Array(8000)); }, cancel,
        });
        const request = new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
        await expectError(await POST(request), 413, 'PAYLOAD_TOO_LARGE');
        expect(cancel).toHaveBeenCalled();
        expect(createClient).not.toHaveBeenCalled();
    });

    it.each([
        ['CRM_DUPLICATE_REVIEW_REQUIRED', 409, 'DUPLICATE_REVIEW_REQUIRED'],
        ['CRM_PLOT_UNAVAILABLE', 409, 'PLOT_UNAVAILABLE'],
        ['CRM_IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
        ['CRM_INVALID_INPUT', 400, 'INVALID_INPUT'],
        ['CRM_SALES_OWNER_REQUIRED', 400, 'SALES_OWNER_REQUIRED'],
        ['CRM_FORBIDDEN', 403, 'FORBIDDEN'],
        ['CRM_SETUP_REQUIRED', 503, 'SETUP_REQUIRED'],
    ])('maps %s without leaking database details', async (message, status, code) => {
        setupRpc('sales', { crm_v2_create_customer: { error: { code: 'P0001', message, details: 'customer private data' } } });
        await expectError(await POST(postRequest()), Number(status), String(code));
    });

    it.each([
        ['23505', 409, 'CONFLICT'], ['22023', 400, 'INVALID_INPUT'], ['22P02', 400, 'INVALID_INPUT'],
        ['42501', 403, 'FORBIDDEN'], ['PGRST202', 503, 'SETUP_REQUIRED'], ['XX000', 503, 'SERVICE_UNAVAILABLE'],
    ])('maps SQL error %s safely', async (sqlCode, status, code) => {
        setupRpc('sales', { crm_v2_create_customer: { error: { code: sqlCode, message: 'raw customer phone or SQL' } } });
        await expectError(await POST(postRequest()), Number(status), String(code));
    });

    it('treats an incompatible successful create result as uncertain, preserving retry safety', async () => {
        setupRpc('sales', { crm_v2_create_customer: { data: { id: CUSTOMER } } });
        await expectError(await POST(postRequest()), 503, 'SERVICE_UNAVAILABLE');
    });
});
