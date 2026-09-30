// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/visits/route';
import { viId, viInput, viResult, viSnapshot } from './visitsFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_VISITS_ENABLED'];
const get = (suffix = '', token = true) => new Request(`https://local.invalid/api/sales-crm/visits?customerId=${viId(1)}&interestId=${viId(2)}${suffix}`, { headers: token ? { Authorization: 'Bearer test-token' } : {} });
const post = (body: unknown = viInput(), headers: Record<string, string> = {}) => new Request('https://local.invalid/api/sales-crm/visits', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function configure(role = 'sales', overrides: Record<string, unknown> = {}) {
  mock.rpc.mockImplementation(async (name: string) => overrides[name] ?? ({ crm_v2_role: { data: role }, crm_v2_visits_capabilities: { data: { enabled: true, contract_version: 'visits_v1' } },
    crm_v2_visits_context: { data: { ...viSnapshot(), actor: { userId: viId(5), role }, scope: { ...viSnapshot().scope, canEdit: role !== 'owner' } } }, crm_v2_visits_command: { data: viResult() } }[name]));
}
beforeEach(() => {
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits');
  vi.resetAllMocks(); flags.forEach(key => vi.stubEnv(key, 'true')); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc }); mock.getUser.mockResolvedValue({ data: { user: { id: viId(5), user_metadata: { role: 'admin' } } } }); configure();
});
afterEach(() => vi.unstubAllEnvs());
async function error(response: Response, status: number, code: string) { expect(response.status).toBe(status); expect((await response.json()).error.code).toBe(code); }
describe('visits caller-JWT routes', () => {
  it.each(flags)('gates %s before any network/client construction', async key => {
    vi.stubEnv(key, 'TRUE'); await error(await route.GET(get()), 503, 'FEATURE_DISABLED'); await error(await route.POST(post()), 503, 'FEATURE_DISABLED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('reads bounded scope with no-store and exact argument mapping', async () => {
    const result = await route.GET(get()); expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect((await result.json()).data).toEqual(viSnapshot());
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_visits_context', { p_customer_id: viId(1), p_interest_id: viId(2), p_appointment_page: 0, p_visit_page: 0, p_event_page: 0 });
  });
  it('writes through one atomic caller RPC and validates replay', async () => {
    const result = await route.POST(post()); expect(result.status).toBe(201); expect((await result.json()).data).toEqual(viResult());
    const { requestId, ...payload } = viInput(); expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_visits_command', { p_request_id: requestId, p_payload: payload });
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer test-token');
    configure('sales', { crm_v2_visits_command: { data: viResult(viInput(), { replayed: true }) } }); expect((await route.POST(post())).status).toBe(200);
  });
  it.each(['sales', 'admin', 'owner'])('lets %s read all allowed project scope', async role => { configure(role); expect((await route.GET(get())).status).toBe(200); });
  it('does not trust role metadata and keeps Owner readonly', async () => {
    configure('owner'); await error(await route.POST(post()), 403, 'FORBIDDEN'); configure('contractor'); await error(await route.GET(get()), 403, 'FORBIDDEN');
    expect(mock.rpc.mock.calls.some(call => call[0] === 'crm_v2_visits_command')).toBe(false);
  });
  it('requires authenticated user and exact readiness version', async () => {
    await error(await route.GET(get('', false)), 401, 'UNAUTHENTICATED');
    configure('sales', { crm_v2_visits_capabilities: { data: { enabled: true, contract_version: 'wrong' } } }); await error(await route.POST(post()), 503, 'SETUP_REQUIRED');
    mock.getUser.mockResolvedValue({ data: { user: null } }); await error(await route.GET(get()), 401, 'UNAUTHENTICATED');
  });
  it.each(['sb_secret_bad', `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`])('rejects privileged key %s', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await error(await route.POST(post()), 503, 'SETUP_REQUIRED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each([{ role: 'admin' }, { command: 'complete_visit' }, { startsAt: 'not a time' }, { occurredAt: 'now' }])('blocks unsafe fields before authorization %j', async change => {
    await error(await route.POST(post({ ...viInput(), ...change })), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('validates duplicate/unknown query fields before client', async () => {
    for (const suffix of ['&interestId=bad', '&actor=admin', '&eventPage=-1']) await error(await route.GET(get(suffix)), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('bounds declared and streamed body and rejects wrong media', async () => {
    await error(await route.POST(post(viInput(), { 'Content-Type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await error(await route.POST(post(viInput(), { 'Content-Length': '16385' })), 413, 'PAYLOAD_TOO_LARGE');
    await error(await route.POST(post({ ...viInput(), reason: 'ก'.repeat(16385) })), 413, 'PAYLOAD_TOO_LARGE'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each(['customerId', 'interestId', 'requestId', 'appointmentRevision'])('retains ambiguity for malformed committed receipt %s', async field => {
    configure('sales', { crm_v2_visits_command: { data: { ...viResult(), [field]: field === 'appointmentRevision' ? null : viId(99) } } });
    await error(await route.POST(post()), 503, 'UNKNOWN_RESULT');
  });
  it('rejects foreign snapshot scope or actor without leaking it', async () => {
    const value = viSnapshot(); value.actor.userId = viId(99); configure('sales', { crm_v2_visits_context: { data: value } }); await error(await route.GET(get()), 503, 'SETUP_REQUIRED');
    value.actor.userId = viId(5); value.scope.customerId = viId(99); await error(await route.GET(get()), 503, 'SETUP_REQUIRED');
  });
  it.each([['FORBIDDEN', 403], ['NOT_FOUND', 404], ['INVALID_INPUT', 400], ['CONFLICT', 409], ['STALE_STATE', 409], ['SCOPE_CLOSED', 409], ['IDEMPOTENCY_CONFLICT', 409], ['SETUP_REQUIRED', 503]] as const)('maps safe SQL marker %s', async (code, status) => {
    configure('sales', { crm_v2_visits_command: { error: { code: 'P0001', message: `CRM_VISITS_${code}` } } }); await error(await route.POST(post()), status, code);
  });
  it('sanitizes unexpected RPC failures as uncertain writes or failed reads', async () => {
    mock.rpc.mockRejectedValue(new Error('private detail')); const result = await route.POST(post()); expect(result.status).toBe(503); expect(await result.text()).not.toContain('private detail');
    await error(await route.GET(get()), 503, 'READ_UNAVAILABLE');
  });
});
