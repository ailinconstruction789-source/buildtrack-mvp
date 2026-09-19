// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table access forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import * as route from '@/app/api/sales-crm/sla-receipts/route';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002', TASK = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T02:45:00.123456Z', INPUT = { requestId: REQUEST, taskId: TASK }, actor = { userId: ADMIN, role: 'admin' };
const FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED'];
const CAPABILITY = 'crm_v2_sla_receipt_capabilities', READ = 'crm_v2_first_contact_receipt';
function receipt() { return { actor, ...INPUT, processedAt: AT, replayed: false, outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: AT,
    staffDueAt: null, notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null, withdrawnCount: 0 }; }
function lookup() { return { actor, ...INPUT, found: true, receipt: receipt() }; }
const query = `requestId=${REQUEST}&taskId=${TASK}`;
const get = (search = '', authorization = 'Bearer caller-token') => new Request(`https://app.test/api/sales-crm/sla-receipts${search ? `?${search}` : ''}`, { headers: { authorization } });
function setupRpc(role: unknown = 'admin', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: { contract_version: 'first_contact_receipt_review_v1', enabled: true, processing_enabled: true }, error: null };
        if (name === READ) return { data: lookup(), error: null };
        throw new Error('Unexpected RPC, processor forbidden');
    });
}
async function errorResponse(response: Response, status: number, code: string) {
    expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json(); expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message).not.toMatch(/private|raw SQL|token=secret|CRM_SLA_RECEIPT_/); return body;
}
beforeEach(() => {
    vi.clearAllMocks(); FLAGS.forEach(flag => vi.stubEnv(flag, 'true')); vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
    getUser.mockResolvedValue({ data: { user: { id: ADMIN, user_metadata: { role: 'admin' } } }, error: null }); setupRpc();
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled(); expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, READ].includes(String(call[0])))).toBe(true);
    vi.unstubAllEnvs();
});

describe('read-only six gates and trusted Admin', () => {
    it('exports only dynamic Node GET, no processing handler', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']); expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic');
    });
    for (const flag of FLAGS) it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exacttrue ${flag}=%j before auth`, async value => {
        vi.stubEnv(flag, value); await errorResponse(await route.GET(get()), 503, 'FEATURE_DISABLED'); await errorResponse(await route.GET(get(query)), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });
    it.each(['sales', 'owner', 'foreman', '', null, { role: 'admin' }])('denies trustedrole%j despite editablemetadata', async role => {
        setupRpc(role); await errorResponse(await route.GET(get(query)), 403, 'FORBIDDEN'); expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role']);
    });
    it.each(['', 'Basic secret', 'Bearer ', 'Bearer two tokens', `Bearer ${'x'.repeat(8193)}`])('rejects malformedbearer%j', async authorization => {
        await errorResponse(await route.GET(get('', authorization)), 401, 'UNAUTHENTICATED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ADMIN}\n` }])('requires verifiedUUIDuser%j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null }); await errorResponse(await route.GET(get(query)), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('rejects autherror even when user accompanies it', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: { message: 'private' } }); await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('uses verified JWT/publickey only', async () => {
        expect((await route.GET(get(query))).status).toBe(200); expect(getUser).toHaveBeenCalledExactlyOnceWith('caller-token');
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer caller-token' } },
        });
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('failsclosed for missing%s', async flag => {
        vi.stubEnv(flag, ''); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_private', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privilegedkey%s', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { contract_version: 'wrong', enabled: true, processing_enabled: true },
        { contract_version: 'first_contact_receipt_review_v1', enabled: false, processing_enabled: true },
        { contract_version: 'first_contact_receipt_review_v1', enabled: 'true', processing_enabled: true },
        { contract_version: 'first_contact_receipt_review_v1', enabled: true },
        { contract_version: 'first_contact_receipt_review_v1', enabled: true, processing_enabled: 'true' }])('requires strict capability%j', async data => {
        setupRpc('admin', { [CAPABILITY]: { data } }); await errorResponse(await route.GET(get(query)), 503, 'SETUP_REQUIRED'); expect(rpc).toHaveBeenCalledTimes(2);
    });
});
describe('lookup stays available while processing disabled', () => {
    it.each([undefined, '', 'false', 'TRUE', '1', 'true'])('serverseventhflag%s only affects contextpermission', async flag => {
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', flag);
        expect(await (await route.GET(get())).json()).toEqual({ data: { actor, processingEnabled: flag === 'true' } });
        expect(await (await route.GET(get(query))).json()).toEqual({ data: lookup() });
        expect(rpc.mock.calls.filter(call => call[0] === READ)).toHaveLength(1);
    });
    it.each([false, true])('DBprocessing_enabled%s participates in context conjunction', async processing_enabled => {
        setupRpc('admin', { [CAPABILITY]: { data: { contract_version: 'first_contact_receipt_review_v1', enabled: true, processing_enabled } } });
        expect(await (await route.GET(get())).json()).toEqual({ data: { actor, processingEnabled: processing_enabled } });
        expect(await (await route.GET(get(query))).json()).toEqual({ data: lookup() });
    });
    it('context never calls receiptlookup or processor', async () => {
        expect((await route.GET(get())).status).toBe(200); expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', CAPABILITY]);
    });
    it('only forwards canonical two-ID input and projects historical receipt', async () => {
        const data = { ...lookup(), requestId: ADMIN, receipt: { ...receipt(), requestId: ADMIN, private: 'hidden' }, rawLedger: {} };
        setupRpc('admin', { [READ]: { data } }); const response = await route.GET(get(`requestId=${ADMIN.toUpperCase()}&taskId=${TASK}`));
        expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { ...lookup(), requestId: ADMIN, receipt: { ...receipt(), requestId: ADMIN } } });
        expect(rpc).toHaveBeenLastCalledWith(READ, { p_request: { requestId: ADMIN, taskId: TASK } });
    });
    it('notfound remains a minimal observation with no noncommit proof', async () => {
        setupRpc('admin', { [READ]: { data: { actor, ...INPUT, found: false, receipt: null, definitelyNotProcessed: true } } });
        expect(await (await route.GET(get(query))).json()).toEqual({ data: { actor, ...INPUT, found: false, receipt: null } });
    });
    it.each([`requestId=${REQUEST}`, `taskId=${TASK}`, `requestId=${REQUEST}&taskId=${TASK}&requestId=${REQUEST}`, `${query}&actorId=${ADMIN}`,
        `${query}&process=true`, `requestId=${REQUEST}%0A&taskId=${TASK}`, 'page=0'])('rejects malformedquery%s before network', async search => {
        await errorResponse(await route.GET(get(search)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { ...lookup(), actor: { userId: OTHER, role: 'admin' } }, { ...lookup(), requestId: OTHER }, { ...lookup(), taskId: OTHER },
        { ...lookup(), found: false }, { ...lookup(), receipt: { ...receipt(), actor: { userId: OTHER, role: 'admin' } } }])('rejects bad lookup%j without leaking it', async data => {
        setupRpc('admin', { [READ]: { data } }); await errorResponse(await route.GET(get(query)), 503, 'SETUP_REQUIRED');
    });
});
describe('safe read failures never invoke processor', () => {
    it.each(['crm_v2_role', CAPABILITY, READ])('doesnotfallback when%s missing', async name => {
        setupRpc('admin', { [name]: { error: { code: 'PGRST202', message: 'private raw SQL' } } }); await errorResponse(await route.GET(get(query)), 503, 'SETUP_REQUIRED');
    });
    it.each([['FORBIDDEN', 403], ['SETUP_REQUIRED', 503], ['INVALID_INPUT', 400]])('maps exactCRM_SLA_RECEIPT_%s only', async (code, status) => {
        setupRpc('admin', { [READ]: { error: { code: 'P0001', message: `CRM_SLA_RECEIPT_${code}` } } }); await errorResponse(await route.GET(get(query)), Number(status), String(code));
    });
    it.each([{ code: 'XX000', message: 'private raw SQL' }, { code: 'P0001', message: 'CRM_SLA_RECEIPT_FORBIDDEN extra' },
        { code: 'XX000', message: 'CRM_SLA_RECEIPT_FORBIDDEN' }])('sanitizes unexpectederror%j', async error => {
        setupRpc('admin', { [READ]: { error } }); await errorResponse(await route.GET(get(query)), 503, 'READ_UNAVAILABLE');
    });
    it('sanitizes thrown failures without automaticretry', async () => {
        rpc.mockRejectedValue(new Error('private token=secret')); await errorResponse(await route.GET(get(query)), 503, 'READ_UNAVAILABLE'); expect(rpc).toHaveBeenCalledTimes(1);
    });
});
