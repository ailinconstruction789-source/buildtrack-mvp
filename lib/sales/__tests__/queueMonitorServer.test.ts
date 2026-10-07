// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
    const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn(() => { throw new Error('Direct table access forbidden'); });
    return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import * as route from '@/app/api/sales-crm/queue-monitor/route';
import { QUEUE_MONITOR_CONTRACT_VERSION } from '../queueMonitorContracts';

const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const AT = '2026-09-23T02:45:00.123456Z';
const FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED', 'SALES_CRM_QUEUE_MONITOR_ENABLED'];
const CAPABILITY = 'crm_v2_queue_monitor_capabilities', READ = 'crm_v2_queue_monitor_snapshot';
function snapshot() {
    return { contractVersion: QUEUE_MONITOR_CONTRACT_VERSION, actor: { userId: ADMIN, role: 'admin' }, asOf: AT, readOnly: true,
        targetSeconds: 300, deliveryLatencySeconds: null, sweepAgeSeconds: null,
        gates: { processing: false, cycle: false, worker: false, dispatcher: false, burst: false },
        candidates: { sampleCount: 895, exact: true, scanLimit: 901, storedHeldCount: 10, withoutStoredReviewCount: 885 },
        cursor: { afterCreatedAt: null, afterTaskId: null }, currentRequest: null };
}
const get = (search = '', authorization = 'Bearer caller-token') => new Request(`https://app.test/api/sales-crm/queue-monitor${search ? `?${search}` : ''}`, { headers: { authorization } });
function setupRpc(role: unknown = 'admin', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    rpc.mockImplementation(async (name: string) => {
        if (overrides[name]) return { data: null, error: null, ...overrides[name] };
        if (name === 'crm_v2_role') return { data: role, error: null };
        if (name === CAPABILITY) return { data: { contract_version: QUEUE_MONITOR_CONTRACT_VERSION, enabled: true }, error: null };
        if (name === READ) return { data: snapshot(), error: null };
        throw new Error('Unexpected RPC, processing and dispatch forbidden');
    });
}
async function errorResponse(response: Response, status: number, code: string) {
    expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json(); expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message).not.toMatch(/private|raw SQL|token=secret|CRM_QUEUE_MONITOR_/);
}
beforeEach(() => {
    vi.clearAllMocks(); FLAGS.forEach(flag => vi.stubEnv(flag, 'true'));
    vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
    getUser.mockResolvedValue({ data: { user: { id: ADMIN, user_metadata: { role: 'admin' } } }, error: null }); setupRpc();
});
afterEach(() => {
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(call => ['crm_v2_role', CAPABILITY, READ].includes(String(call[0])) && call.length === 1)).toBe(true);
    vi.unstubAllEnvs();
});

describe('read-only queue monitor gates and trusted Admin', () => {
    it('exports only dynamic Node GET with no writer or recovery handler', () => {
        expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
        expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic');
    });
    for (const flag of FLAGS) it.each([undefined, '', 'false', 'TRUE', '1'])(`requires exact true ${flag}=%j before network`, async value => {
        vi.stubEnv(flag, value); await errorResponse(await route.GET(get()), 503, 'FEATURE_DISABLED');
        expect(createClient).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    });
    it.each(['sales', 'owner', 'foreman', '', null, { role: 'admin' }])('denies trusted role %j despite editable metadata', async role => {
        setupRpc(role); await errorResponse(await route.GET(get()), 403, 'FORBIDDEN');
        expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role']);
    });
    it.each(['', 'Basic secret', 'Bearer ', 'Bearer two tokens', `Bearer ${'x'.repeat(8193)}`])('rejects malformed bearer %j', async authorization => {
        await errorResponse(await route.GET(get('', authorization)), 401, 'UNAUTHENTICATED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, {}, { id: 'bad' }, { id: `${ADMIN}\n` }])('requires verified UUID user %j', async user => {
        getUser.mockResolvedValue({ data: { user }, error: null }); await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('rejects an auth error even when a user accompanies it', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: { message: 'private' } });
        await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
    });
    it('uses the verified captured bearer and public key, never browser metadata authority', async () => {
        getUser.mockResolvedValue({ data: { user: { id: ADMIN.toUpperCase(), user_metadata: { role: 'sales' } } }, error: null });
        expect((await route.GET(get())).status).toBe(200); expect(getUser).toHaveBeenCalledExactlyOnceWith('caller-token');
        expect(createClient).toHaveBeenCalledExactlyOnceWith('https://supabase.test', 'public-anon', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer caller-token' } },
        });
        expect(rpc.mock.calls).toEqual([['crm_v2_role'], [CAPABILITY], [READ]]);
    });
    it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])('fails closed for missing %s', async flag => {
        vi.stubEnv(flag, ''); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each(['sb_secret_private', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged key %s', async key => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { contract_version: 'wrong', enabled: true }, { contract_version: QUEUE_MONITOR_CONTRACT_VERSION, enabled: false },
        { contract_version: QUEUE_MONITOR_CONTRACT_VERSION, enabled: 'true' }, { contract_version: QUEUE_MONITOR_CONTRACT_VERSION }])('requires strict capability %j', async data => {
        setupRpc('admin', { [CAPABILITY]: { data } }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED'); expect(rpc).toHaveBeenCalledTimes(2);
    });
});

describe('bounded observation while writers remain disabled', () => {
    it.each([undefined, '', 'false', 'TRUE', '1', 'true'])('does not depend on processing env %j', async value => {
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', value);
        expect(await (await route.GET(get())).json()).toEqual({ data: snapshot() });
    });
    it('returns only the whitelist and no-store headers', async () => {
        const base = snapshot();
        const data = { ...base, privateLedger: { token: 'secret' }, actor: { ...base.actor, email: 'private' },
            gates: { ...base.gates, secret: 'private' }, candidates: { ...base.candidates, rawTasks: ['private'] }, cursor: { ...base.cursor, income: 99 } };
        setupRpc('admin', { [READ]: { data } }); const response = await route.GET(get());
        expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: base });
        expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('vary')).toBe('Authorization');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });
    it('projects a historical receipt without exposing its raw evaluation or allowing recovery', async () => {
        const currentRequest = { requestId: ADMIN, attemptId: OTHER, attemptCount: 1, status: 'completed', policyVersion: 'bounded_burst_v2',
            createdAt: AT, preparedAt: AT, nextAttemptAt: AT, completedAt: AT, lastErrorCode: null,
            receipt: { startedAt: AT, finishedAt: AT, processedCount: 10, sweepFinished: false, heldCount: 2, notifiedCount: 8 } };
        setupRpc('admin', { [READ]: { data: { ...snapshot(), currentRequest: { ...currentRequest, raw_error: 'private',
            receipt: { ...currentRequest.receipt, evaluations: [{ income: 99 }], definitelyNotProcessed: false } } } } });
        expect(await (await route.GET(get())).json()).toEqual({ data: { ...snapshot(), currentRequest } });
    });
    it.each(['page=0', `actorId=${OTHER}`, `requestId=${ADMIN}`, 'process=true', 'retry=true', 'enabled=true', '=ignored', 'limit=10&limit=10'])('rejects every query %s before network', async search => {
        await errorResponse(await route.GET(get(search)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { ...snapshot(), actor: { userId: OTHER, role: 'admin' } }, { ...snapshot(), actor: { userId: ADMIN, role: 'owner' } },
        { ...snapshot(), readOnly: false }, { ...snapshot(), deliveryLatencySeconds: 0 }, { ...snapshot(), sweepAgeSeconds: 300 },
        { ...snapshot(), candidates: { ...snapshot().candidates, sampleCount: 902 } }, { ...snapshot(), currentRequest: {} }])('rejects malformed or wrong-scope snapshot %j', async data => {
        setupRpc('admin', { [READ]: { data } }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
    });
});

describe('sanitized failures never invoke writer RPCs or retry', () => {
    for (const name of ['crm_v2_role', CAPABILITY, READ]) {
        it.each(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])(`${name}: maps missing installation %s without fallback`, async code => {
            setupRpc('admin', { [name]: { error: { code, message: 'private raw SQL' } } }); await errorResponse(await route.GET(get()), 503, 'SETUP_REQUIRED');
        });
        it.each(['PGRST301', 'PGRST302', 'PGRST303'])(`${name}: maps rejected authorization %s`, async code => {
            setupRpc('admin', { [name]: { error: { code, message: 'private raw SQL' } } }); await errorResponse(await route.GET(get()), 401, 'UNAUTHENTICATED');
        });
        it(`${name}: maps database privilege denial`, async () => {
            setupRpc('admin', { [name]: { error: { code: '42501', message: 'private raw SQL' } } }); await errorResponse(await route.GET(get()), 403, 'FORBIDDEN');
        });
    }
    it.each([['FORBIDDEN', 403], ['SETUP_REQUIRED', 503]])('maps exact CRM_QUEUE_MONITOR_%s marker', async (code, status) => {
        setupRpc('admin', { [READ]: { error: { code: 'P0001', message: `CRM_QUEUE_MONITOR_${code}` } } });
        await errorResponse(await route.GET(get()), Number(status), String(code));
    });
    it.each([{ code: 'XX000', message: 'private raw SQL' }, { code: 'P0001', message: 'CRM_QUEUE_MONITOR_FORBIDDEN extra' },
        { code: 'XX000', message: 'CRM_QUEUE_MONITOR_FORBIDDEN' }, { code: 'P0001', message: 'CRM_QUEUE_MONITOR_INVALID_INPUT' }])('sanitizes unexpected error %j', async error => {
        setupRpc('admin', { [READ]: { error } }); await errorResponse(await route.GET(get()), 503, 'READ_UNAVAILABLE');
    });
    it('sanitizes thrown RPC failures without automatic retry', async () => {
        rpc.mockRejectedValue(new Error('private token=secret')); await errorResponse(await route.GET(get()), 503, 'READ_UNAVAILABLE'); expect(rpc).toHaveBeenCalledTimes(1);
    });
    it('sanitizes thrown identity-service failures before any RPC', async () => {
        getUser.mockRejectedValueOnce(new Error('private token=secret')); await errorResponse(await route.GET(get()), 503, 'READ_UNAVAILABLE'); expect(rpc).not.toHaveBeenCalled();
    });
});
