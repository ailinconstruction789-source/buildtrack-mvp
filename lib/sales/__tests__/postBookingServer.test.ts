// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/post-booking/route';
import { postBookingEnabled } from '../postBookingServer';
import { pbid, pbInput, pbResult, pbSnapshot, pbTransfer } from './postBookingFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED', 'SALES_CRM_POST_BOOKING_ENABLED'];
const get = (query = `?saleId=${pbid(1)}`, token = true) => new Request(`https://test.invalid/${query}`, { headers: token ? { authorization: 'Bearer fake-token' } : {} });
const post = (body: unknown = pbInput(), headers: Record<string, string> = {}) => new Request('https://test.invalid/', {
  method: 'POST', headers: { authorization: 'Bearer fake-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
function configure(role = 'sales', overrides: Record<string, unknown> = {}) {
  const snapshot = pbSnapshot(); snapshot.actor.role = role as never; if (role === 'owner') snapshot.sale.canEdit = false;
  mock.rpc.mockImplementation(async name => overrides[name] ?? { data: name === 'crm_v2_role' ? role
    : name === 'crm_v2_post_booking_capabilities' ? { enabled: true, contract_version: 'post_booking_v2' }
      : name === 'crm_v2_post_booking_command' ? pbResult() : snapshot, error: null });
}
beforeEach(() => {
  vi.clearAllMocks(); flags.forEach(flag => vi.stubEnv(flag, 'true'));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: pbid(6), user_metadata: { role: 'admin' } } }, error: null }); configure();
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  const body = await response.json(); expect(body.error.code).toBe(code); expect(JSON.stringify(body)).not.toMatch(/fake-token|private customer/);
}
describe('post-booking server boundary', () => {
  it.each(flags)('checks %s before any read or write client is made', async flag => {
    vi.stubEnv(flag, 'false'); expect(postBookingEnabled()).toBe(false);
    await error(await route.GET(get()), 503, 'FEATURE_DISABLED'); await error(await route.POST(post()), 503, 'FEATURE_DISABLED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('reads only the scoped context, never starts a command from GET', async () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic', 'runtime']);
    const response = await route.GET(get()); expect(response.status).toBe(200); expect((await response.json()).data).toEqual(pbSnapshot());
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_post_booking_capabilities', 'crm_v2_post_booking_context']);
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_post_booking_context', { p_sale_id: pbid(1), p_attempt_page: 0, p_event_page: 0 });
  });
  it('sends one atomic caller-scoped command with exact request ID', async () => {
    const response = await route.POST(post()); expect(response.status).toBe(201); expect((await response.json()).data).toEqual(pbResult());
    const { requestId, ...payload } = pbInput(); expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_post_booking_command', { p_request_id: requestId, p_payload: payload });
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer fake-token');
    configure('sales', { crm_v2_post_booking_command: { data: pbResult(pbInput(), true) } }); expect((await route.POST(post())).status).toBe(200);
  });
  it.each(['sales', 'admin', 'owner'])('lets %s read trusted projections', async role => { configure(role); expect((await route.GET(get())).status).toBe(200); });
  it('does not trust metadata for writes and keeps executive Owner read-only', async () => {
    configure('owner'); await error(await route.POST(post()), 403, 'FORBIDDEN');
    configure('contractor'); await error(await route.GET(get()), 403, 'FORBIDDEN');
    expect(mock.rpc.mock.calls.some(call => call[0] === 'crm_v2_post_booking_command')).toBe(false);
    await error(await route.GET(get('', false)), 400, 'INVALID_INPUT');
    await error(await route.GET(get(undefined, false)), 401, 'UNAUTHENTICATED');
  });
  it.each(['sb_secret_forbidden', `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`])('refuses privileged key %s', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await error(await route.POST(post()), 503, 'SETUP_REQUIRED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false, contract_version: 'post_booking_v2' }, { enabled: true, contract_version: 'post_booking_v1' }, { enabled: true, contract_version: 'wrong' }, null])('requires exact SQL readiness %j', async data => {
    configure('sales', { crm_v2_post_booking_capabilities: { data } }); await error(await route.POST(post()), 503, 'SETUP_REQUIRED');
  });
  it.each([{ nextStage: 'transferred' }, { nextStage: 'handover' }, { role: 'admin' }, { occurredAt: 'now' }])('blocks unsafe command shape before constructing client %j', async patch => {
    await error(await route.POST(post({ ...pbInput(), ...patch })), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('checks media type and both declared/streamed body sizes', async () => {
    await error(await route.POST(post(pbInput(), { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await error(await route.POST(post(pbInput(), { 'content-length': '16385' })), 413, 'PAYLOAD_TOO_LARGE');
    await error(await route.POST(post({ ...pbInput(), reason: 'ก'.repeat(16385) })), 413, 'PAYLOAD_TOO_LARGE');
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('marks wrong/ambiguous write receipt as unknown, not definitely failed', async () => {
    configure('sales', { crm_v2_post_booking_command: { data: { ...pbResult(), saleId: pbid(99) } } });
    await error(await route.POST(post()), 503, 'UNKNOWN_RESULT');
    mock.rpc.mockRejectedValue(new Error('private customer')); await error(await route.POST(post()), 503, 'UNKNOWN_RESULT');
  });
  it('sends a transfer date and reason only, accepts matching receipt, preserves uncertainty on a changed day', async () => {
    const input = pbTransfer(), { requestId, ...payload } = input;
    configure('sales', { crm_v2_post_booking_command: { data: pbResult(input) } });
    const response = await route.POST(post(input)); expect(response.status).toBe(201);
    expect((await response.json()).data.transferDate).toBe(input.transferDate);
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_post_booking_command', { p_request_id: requestId, p_payload: payload });
    expect(payload).not.toHaveProperty('occurredAt'); expect(payload).not.toHaveProperty('evidenceNote');
    configure('sales', { crm_v2_post_booking_command: { data: { ...pbResult(input), transferDate: '2026-09-22' } } });
    await error(await route.POST(post(input)), 503, 'UNKNOWN_RESULT');
  });
  it.each([{ transferDate: '2026-02-30' }, { transferDate: '2026-09-23T00:00:00Z' }, { evidenceNote: 'file' }, { occurredAt: '2026-09-23T00:00:00Z' }])('rejects fabricated transfer time or invalid date before sending %j', async patch => {
    await error(await route.POST(post({ ...pbTransfer(), ...patch })), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('rejects wrong read actor, sale and page instead of showing foreign data', async () => {
    for (const raw of [{ ...pbSnapshot(), actor: { userId: pbid(99), role: 'sales' } }, { ...pbSnapshot(), eventPage: 1 }]) {
      configure('sales', { crm_v2_post_booking_context: { data: raw } }); await error(await route.GET(get()), 503, 'SETUP_REQUIRED');
    }
  });
  it.each([['PGRST202', '', 503, 'SETUP_REQUIRED'], ['P0001', 'CRM_POST_BOOKING_STALE_STATE', 409, 'STALE_STATE'],
    ['P0001', 'CRM_POST_BOOKING_IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'], ['P0001', 'CRM_POST_BOOKING_FORBIDDEN', 403, 'FORBIDDEN'],
    ['unknown', 'private customer', 503, 'UNKNOWN_RESULT']] as const)('sanitizes RPC %s %s', async (code, message, status, result) => {
    configure('sales', { crm_v2_post_booking_command: { error: { code, message } } }); await error(await route.POST(post()), status, result);
  });
});
