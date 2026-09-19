// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from, buildSlaPreview } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })), buildSlaPreview: vi.fn() };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('../slaPreviewEngine', () => ({ buildSlaPreview }));
import * as route from '@/app/api/sales-crm/sla-preview/route';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OWNER = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002', CUSTOMER = '00000000-0000-4000-8000-000000000003';
const REVISION = '00000000-0000-4000-8000-000000000004';
const AT = '2026-09-17T02:45:00.123456Z', DUE = '2026-09-17T03:00:00.123456Z', LEAD = '2026-09-16T03:00:00.123456Z';
const FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED'];
const CAPABILITY = 'crm_v2_sla_preview_capabilities', SOURCE = 'crm_v2_sla_preview_source';
function task() { return { id: TASK, customerId: CUSTOMER, customerName: 'ลูกค้า', ownerUserId: OWNER, ownerName: 'Sales', scopeOwnerUserId: OWNER,
    ownerIsActiveSales: true, lifecycleRevision: REVISION, scopeClosed: false, recordOrigin: 'live', leadCreatedAt: LEAD,
    obligationStartedAt: LEAD, serviceDueAt: DUE, taskCreatedAt: LEAD, initialContactHours: 24, creationProven: true,
    ownerHistoryUnchanged: true, lifecycleReviewPending: false, hasContactEvidence: false, hasCustomerPostponement: false, hasExceptions: false, calendar: null }; }
function source(page = 0) { return { actor: { userId: ADMIN, role: 'admin' }, asOf: AT, page, pageSize: 20, hasMore: false,
    settings: { version: 1, initialContactHours: 24, nextShiftResponseMinutes: 120 }, tasks: [task()] }; }
function snapshot(page = 0) { return { actor: { userId: ADMIN, role: 'admin' }, asOf: AT, page, pageSize: 20, hasMore: false,
    mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17', dueSoonMinutes: 30,
    rows: [{ taskId: TASK, customerId: CUSTOMER, customerName: 'ลูกค้า', ownerUserId: OWNER, ownerName: 'Sales', serviceDueAt: DUE,
        state: 'held', reason: 'MISSING_CALENDAR', staffDueAt: null, notifyAt: null, rule: null, calendarVersion: null, notificationType: null }] }; }
const get = (query = '', authorization = 'Bearer caller-token') => new Request(`https://app.test/api/sales-crm/sla-preview${query ? `?${query}` : ''}`, { headers: { authorization } });
function setupRpc(role: unknown = 'admin', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string, args?: { p_page: number }) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: { contract_version: 'first_contact_preview_v1', enabled: true }, error: null };
        if (name === SOURCE) return { data: source(args?.p_page ?? 0), error: null };
        throw new Error('Unexpected RPC');
    });
}
async function errorResponse(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('vary')).toBe('Authorization');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json(); expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message).not.toMatch(/private|raw SQL|token=secret|CRM_SLA_PREVIEW_/); return body;
}
beforeEach(() => {
    vi.clearAllMocks(); FLAGS.forEach(flag => vi.stubEnv(flag, 'true'));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
    getUser.mockResolvedValue({ data: { user: { id: ADMIN, user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } }, error: null });
    setupRpc(); buildSlaPreview.mockImplementation((input: { page: number }) => snapshot(input.page));
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled(); expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, SOURCE].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});
describe('six-layer read-only preview gate and verified Admin authority', () => {
    it('exports GET only, dynamic Node runtime and no mutation handlers', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']); expect(route.dynamic).toBe('force-dynamic'); expect(route.runtime).toBe('nodejs');
    });
    for (const flag of FLAGS) it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exacttrue ${flag}=%j before auth/network`, async value => {
        vi.stubEnv(flag, value); await errorResponse(await route.GET(get()), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(buildSlaPreview).not.toHaveBeenCalled();
    });
    it.each(['sales', 'owner', 'foreman', null, '', { role: 'admin' }])('denies trusted role %j even when editablemetadata saysadmin', async role => {
        setupRpc(role); await errorResponse(await route.GET(get()), 403, 'FORBIDDEN'); expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role']); expect(buildSlaPreview).not.toHaveBeenCalled();
    });
    it.each(['', 'Basic value', 'Bearer ', 'Bearer two tokens', `Bearer ${'x'.repeat(8193)}`])('rejects invalid bearer %j', async authorization => {
        await errorResponse(await route.GET(get('', authorization)), 401, 'UNAUTHENTICATED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ADMIN}\n` }])('requires verified UUIDuser %j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null }); await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('rejects autherror even when user accompanies it', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: { message: 'private' } });
        await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('uses captured verified JWT/publickey without session persistence', async () => {
        expect((await route.GET(get())).status).toBe(200); expect(getUser).toHaveBeenCalledExactlyOnceWith('caller-token');
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer caller-token' } },
        });
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing%s', async flag => {
        vi.stubEnv(flag, ''); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_private', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged key%s', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { contract_version: 'wrong', enabled: true }, { contract_version: 'first_contact_preview_v1', enabled: false },
        { contract_version: 'first_contact_preview_v1', enabled: 'true' }])('requires explicit matching capability %j', async data => {
        setupRpc('admin', { [CAPABILITY]: { data } }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(buildSlaPreview).not.toHaveBeenCalled();
    });
});
describe('bound source, public projection and no delivery', () => {
    it.each([0, 1, 1000])('reads canonical page%s and returns dryrunprojection only', async page => {
        const response = await route.GET(get(`page=${page}`)); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: snapshot(page) });
        expect(rpc).toHaveBeenLastCalledWith(SOURCE, { p_page: page }); expect(buildSlaPreview).toHaveBeenCalledExactlyOnceWith(source(page));
        expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('vary')).toBe('Authorization');
    });
    it.each(['page=', 'page=01', 'page=-0', 'page=1001', 'page=1&page=1', 'page=0%0A', 'salesUserId=x', 'commit=true'])('rejects query%s before network', async query => {
        await errorResponse(await route.GET(get(query)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['actor', 'role', 'page', 'size', 'flags'])('rejects inconsistent source%s before engine', async field => {
        const data: Record<string, unknown> = source();
        if (field === 'actor') data.actor = { userId: OWNER, role: 'admin' }; if (field === 'role') data.actor = { userId: ADMIN, role: 'sales' };
        if (field === 'page') data.page = 1; if (field === 'size') data.pageSize = 50; if (field === 'flags') data.tasks = [{ ...task(), creationProven: 'true' }];
        setupRpc('admin', { [SOURCE]: { data } }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(buildSlaPreview).not.toHaveBeenCalled();
    });
    it('strips raw sourceextras before engine and engineextras before browser', async () => {
        setupRpc('admin', { [SOURCE]: { data: { ...source(), phone: 'private', tasks: [{ ...task(), income: 99, evaluationSnapshot: {} }] } } });
        buildSlaPreview.mockReturnValue({ ...snapshot(), rawSource: source(), rows: [{ ...snapshot().rows[0], calendar: {}, medicalReason: 'private', dedupeKey: 'private' }] });
        const response = await route.GET(get()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: snapshot() }); expect(buildSlaPreview).toHaveBeenCalledWith(source());
    });
    it.each(['mode', 'actor', 'page', 'held_calculation'])('rejects invalid engine%s without leaking it', async field => {
        const value: Record<string, unknown> = snapshot(); if (field === 'mode') value.mode = 'live'; if (field === 'actor') value.actor = { userId: OWNER, role: 'admin' };
        if (field === 'page') value.page = 1; if (field === 'held_calculation') value.rows = [{ ...snapshot().rows[0], staffDueAt: DUE }];
        buildSlaPreview.mockReturnValue(value); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
    });
    it('treats engine exception as setuprequired without raw details', async () => {
        buildSlaPreview.mockImplementation(() => { throw new Error('private raw SQL'); }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
    });
});
describe('safe read-only error handling', () => {
    it.each(['crm_v2_role', CAPABILITY, SOURCE])('never falls back when%s missing', async name => {
        setupRpc('admin', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
    });
    it.each([['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['INVALID_INPUT', 400]])('maps exact CRM_SLA_PREVIEW_%s', async (code, status) => {
        setupRpc('admin', { [SOURCE]: { error: { code: 'P0001', message: `CRM_SLA_PREVIEW_${code}`, details: 'private' } } });
        await errorResponse(await route.GET(get()), Number(status), String(code));
    });
    it.each([{ code: 'XX000', message: 'CRM_SLA_PREVIEW_FORBIDDEN' }, { code: 'P0001', message: 'CRM_SLA_PREVIEW_FORBIDDEN extra' },
        { code: '23505', message: 'private token=secret' }])('sanitizes unexpected RPCerror %j', async error => {
        setupRpc('admin', { [SOURCE]: { error } }); await errorResponse(await route.GET(get()), 503, 'READ_UNAVAILABLE');
    });
    it('does not automatically retry or save after transporterror', async () => {
        rpc.mockRejectedValue(new Error('private token=secret')); await errorResponse(await route.GET(get()), 503, 'READ_UNAVAILABLE'); expect(rpc).toHaveBeenCalledTimes(1);
    });
});
