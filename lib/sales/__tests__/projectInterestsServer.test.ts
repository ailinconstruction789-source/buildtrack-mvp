// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/interests/route';
import { piId, piInput, piResult, piSnapshot } from './projectInterestsFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_PROJECT_INTERESTS_ENABLED'];
const get = (suffix = '', token = true) => new Request(`https://local.invalid/api/sales-crm/interests?customerId=${piId(1)}${suffix}`, { headers: token ? { Authorization: 'Bearer test-token' } : {} });
const post = (body: unknown = piInput(), headers: Record<string, string> = {}) => new Request('https://local.invalid/api/sales-crm/interests', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function configure(role = 'sales', overrides: Record<string, unknown> = {}) {
  mock.rpc.mockImplementation(async (name: string) => overrides[name] ?? ({ crm_v2_role: { data: role }, crm_v2_project_interests_capabilities: { data: { enabled: true, contract_version: 'project_interests_v1' } },
    crm_v2_project_interests_context: { data: { ...piSnapshot(), actor: { userId: piId(6), role }, customer: { ...piSnapshot().customer, canAdd: role !== 'owner' } } }, crm_v2_add_project_interest: { data: piResult() } }[name]));
}
beforeEach(() => {
  vi.resetAllMocks(); flags.forEach(key => vi.stubEnv(key, 'true')); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc }); mock.getUser.mockResolvedValue({ data: { user: { id: piId(6), user_metadata: { role: 'admin' } } } }); configure();
});
afterEach(() => vi.unstubAllEnvs());
async function error(response: Response, status: number, code: string) { expect(response.status).toBe(status); expect((await response.json()).error.code).toBe(code); }
describe('project interest caller JWT routes', () => {
  it.each(flags)('keeps %s disabled before any network access unless exactly true', async key => {
    vi.stubEnv(key, 'TRUE'); await error(await route.GET(get()), 503, 'FEATURE_DISABLED'); await error(await route.POST(post()), 503, 'FEATURE_DISABLED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('reads only exact customer/page and never caches scoped responses', async () => {
    const result = await route.GET(get()); expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect((await result.json()).data).toEqual(piSnapshot());
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_project_interests_context', { p_customer_id: piId(1), p_page: 0 });
  });
  it('writes one atomic caller RPC with unchanged command and validates replay', async () => {
    const result = await route.POST(post()); expect(result.status).toBe(201); expect((await result.json()).data).toEqual(piResult());
    const { requestId, ...payload } = piInput(); expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_add_project_interest', { p_request_id: requestId, p_payload: payload });
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer test-token');
    configure('sales', { crm_v2_add_project_interest: { data: piResult(piInput(), { replayed: true }) } }); expect((await route.POST(post())).status).toBe(200);
  });
  it.each(['sales', 'admin', 'owner'])('lets %s read a customer context', async role => { configure(role); expect((await route.GET(get())).status).toBe(200); });
  it('does not trust role metadata or allow Owner writes', async () => {
    configure('owner'); await error(await route.POST(post()), 403, 'FORBIDDEN'); configure('contractor'); await error(await route.GET(get()), 403, 'FORBIDDEN');
    expect(mock.rpc.mock.calls.some(call => call[0] === 'crm_v2_add_project_interest')).toBe(false);
  });
  it('requires valid user and matching capability', async () => {
    await error(await route.GET(get('', false)), 401, 'UNAUTHENTICATED');
    configure('sales', { crm_v2_project_interests_capabilities: { data: { enabled: true, contract_version: 'wrong' } } }); await error(await route.POST(post()), 503, 'SETUP_REQUIRED');
    mock.getUser.mockResolvedValue({ data: { user: null } }); await error(await route.GET(get()), 401, 'UNAUTHENTICATED');
  });
  it.each(['sb_secret_bad', `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`])('rejects privileged key %s before connecting', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await error(await route.POST(post()), 503, 'SETUP_REQUIRED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each([{ ownerUserId: piId(6) }, { command: 'book' }, { plotId: '' }, { expectedCustomerRevision: null }])('rejects injected/invalid fields before auth %j', async change => {
    await error(await route.POST(post({ ...piInput(), ...change })), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('rejects unknown/duplicate query and malformed UTF8', async () => {
    for (const suffix of ['&customerId=bad', '&actor=admin', '&page=-1']) await error(await route.GET(get(suffix)), 400, 'INVALID_INPUT');
    await error(await route.POST(new Request('https://local.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xc3, 0x28]) })), 400, 'INVALID_INPUT');
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('bounds declared/actual UTF8 bytes and requires JSON', async () => {
    await error(await route.POST(post(piInput(), { 'Content-Type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await error(await route.POST(post(piInput(), { 'Content-Length': '16385' })), 413, 'PAYLOAD_TOO_LARGE');
    await error(await route.POST(post({ ...piInput(), reason: 'ก'.repeat(5500) })), 413, 'PAYLOAD_TOO_LARGE'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each(['customerId', 'projectName', 'requestId', 'plotId'])('retains uncertain outcome for malformed committed %s', async field => {
    configure('sales', { crm_v2_add_project_interest: { data: { ...piResult(), [field]: piId(99) } } }); await error(await route.POST(post()), 503, 'UNKNOWN_RESULT');
  });
  it('blocks foreign snapshot scope or actor without returning it', async () => {
    const value = piSnapshot(); value.actor.userId = piId(99); configure('sales', { crm_v2_project_interests_context: { data: value } }); await error(await route.GET(get()), 503, 'SETUP_REQUIRED');
    value.actor.userId = piId(6); value.customer.id = piId(99); await error(await route.GET(get()), 503, 'SETUP_REQUIRED');
  });
  it.each([['FORBIDDEN', 403], ['NOT_FOUND', 404], ['INVALID_INPUT', 400], ['STALE_STATE', 409], ['SCOPE_CLOSED', 409], ['PROJECT_EXISTS', 409], ['PLOT_UNAVAILABLE', 409], ['IDEMPOTENCY_CONFLICT', 409], ['SETUP_REQUIRED', 503]] as const)('maps exact documented SQL marker %s', async (code, status) => {
    configure('sales', { crm_v2_add_project_interest: { error: { code: 'P0001', message: `CRM_INTERESTS_${code}` } } }); await error(await route.POST(post()), status, code);
  });
  it('sanitizes unexpected backend errors and refuses extra-text lookalike markers', async () => {
    configure('sales', { crm_v2_add_project_interest: { error: { code: 'P0001', message: 'CRM_INTERESTS_FORBIDDEN private detail' } } }); await error(await route.POST(post()), 503, 'UNKNOWN_RESULT');
    mock.rpc.mockRejectedValue(new Error('private detail')); const result = await route.POST(post()); expect(result.status).toBe(503); expect(await result.text()).not.toContain('private detail');
    await error(await route.GET(get()), 503, 'READ_UNAVAILABLE');
  });
});
