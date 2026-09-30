// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, getUser, rpc, from } = vi.hoisted(() => {
  const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn();
  return { getUser, rpc, from, createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import { GET, POST } from '@/app/api/sales-crm/visit-follow-up/route';
import { handleLeadWorkGet, handleLeadWorkPost } from '../leadWorkServer';
const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const INTEREST = '00000000-0000-4000-8000-000000000001';
const ACTION = '00000000-0000-4000-8000-000000000002';
const endpoint = 'https://app.test/api/sales-crm/visit-follow-up';
const payload = { requestId: ACTION, command: 'set_next_action', customerId: USER, interestId: INTEREST, expectedActionId: null,
  nextAction: { action: 'โทรติดตามหลังชม', dueAt: '2026-10-10T12:00:00Z' }, reason: 'ลูกค้านัดติดตาม' };
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_VISITS_ENABLED', 'SALES_CRM_VISIT_SOP_ENABLED', 'SALES_CRM_VISIT_FOLLOW_UP_ENABLED'];
const capabilities = { contract_version: 'visit_follow_up_v1', read_contract_version: 'lead_work_read_v2', enabled: true };
function read(query = `customerId=${USER}&interestId=${INTEREST}`) { return new Request(`${endpoint}?${query}`, { headers: { authorization: 'Bearer caller-token' } }); }
function write(value: unknown = payload) { return new Request(endpoint, { method: 'POST', headers: { authorization: 'Bearer caller-token', 'content-type': 'application/json' }, body: JSON.stringify(value) }); }
function snapshot(role = 'sales') { return { actor: { userId: USER, role }, scope: { customerId: USER, interestId: INTEREST },
  customer: { id: USER, name: 'ลูกค้า', phone: null, leadCreatedAt: null }, projectName: 'โครงการ A', owner: { userId: USER, displayName: 'ฝ่ายขาย', active: true },
  scopeClosed: false, lifecycleRevision: ACTION, canWrite: role === 'sales', asOf: '2026-09-29T12:00:00Z', currentAction: null, actions: [], activities: [],
  history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } }; }
function setup(role = 'sales', overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  rpc.mockImplementation(async (name: string) => {
    if (overrides[name]) return { data: null, error: null, ...overrides[name] };
    if (name === 'crm_v2_role') return { data: role, error: null };
    if (name === 'crm_v2_visit_follow_up_capabilities') return { data: capabilities, error: null };
    if (name === 'crm_v2_visit_follow_up_context') return { data: snapshot(role), error: null };
    if (name === 'crm_v2_visit_follow_up_command') return { data: { nextActionId: ACTION, activityId: null, replayed: false }, error: null };
    throw new Error(`Forbidden RPC: ${name}`);
  });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  expect(await response.json()).toMatchObject({ error: { code } });
}
beforeEach(() => {
  vi.clearAllMocks(); flags.forEach(flag => vi.stubEnv(flag, 'true')); vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
  getUser.mockResolvedValue({ data: { user: { id: USER, app_metadata: { role: 'admin' } } }, error: null }); setup();
});
afterEach(() => { expect(from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
describe('narrow Visit follow-up boundary', () => {
  it.each(flags)('requires exact enabled flag %s before any network', async flag => {
    vi.stubEnv(flag, 'TRUE'); await error(await GET(read()), 503, 'FEATURE_DISABLED'); await error(await POST(write()), 503, 'FEATURE_DISABLED');
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each(['central_booking', 'typo'])('does not widen release scope %s', async scope => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope); await error(await POST(write()), 503, 'FEATURE_DISABLED'); expect(createClient).not.toHaveBeenCalled();
  });
  it('keeps general work sealed even when the narrow route is enabled', async () => {
    await error(await handleLeadWorkGet(read()), 503, 'FEATURE_DISABLED'); await error(await handleLeadWorkPost(write()), 503, 'FEATURE_DISABLED');
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([`customerId=${USER}`, `customerId=${USER}&interestId=`, `customerId=${USER}&interestId=${INTEREST}&interestId=${INTEREST}`, `customerId=${USER}&interestId=${INTEREST}&extra=1`])('requires exact project scope %s', async query => {
    await error(await GET(read(query)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
  });
  it.each(['sales', 'admin', 'owner'])('allows %s to read with Sales-only write authority', async role => {
    setup(role); const response = await GET(read()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: snapshot(role) });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_visit_follow_up_capabilities', 'crm_v2_visit_follow_up_context']);
    expect(rpc).toHaveBeenLastCalledWith('crm_v2_visit_follow_up_context', { p_customer_id: USER, p_interest_id: INTEREST });
  });
  it.each(['admin', 'owner', 'foreman'])('never permits %s write based on metadata', async role => {
    setup(role); await error(await POST(write()), 403, 'FORBIDDEN'); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...payload, interestId: null }, { ...payload, command: 'record_attempt', attempt: { action: 'โทร', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-29T12:00:00Z' } }])('rejects generic command/scope before auth', async value => {
    await error(await POST(write(value)), 400, 'INVALID_INPUT'); expect(createClient).not.toHaveBeenCalled();
  });
  it('sends only next-action through the caller-JWT narrow RPC', async () => {
    expect((await POST(write())).status).toBe(201);
    const { requestId, ...input } = payload;
    expect(rpc).toHaveBeenLastCalledWith('crm_v2_visit_follow_up_command', { p_request_id: requestId, p_payload: input });
    expect(createClient).toHaveBeenCalledWith('https://supabase.test', 'public-anon-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer caller-token' } } });
    expect(getUser).toHaveBeenCalledWith('caller-token');
  });
  it.each([null, { ...capabilities, enabled: false }, { ...capabilities, contract_version: 'lead_work_v1' }, { ...capabilities, read_contract_version: 'v1' }])('rejects incompatible read capability', async data => {
    setup('sales', { crm_v2_visit_follow_up_capabilities: { data } }); await error(await GET(read()), 503, 'SETUP_REQUIRED');
  });
  it('rejects forged Admin write authority and mismatched identity/scope', async () => {
    for (const data of [{ ...snapshot('admin'), canWrite: true }, { ...snapshot('admin'), actor: { userId: ACTION, role: 'admin' } }, { ...snapshot('admin'), scope: { customerId: USER, interestId: ACTION } }]) {
      setup('admin', { crm_v2_visit_follow_up_context: { data } }); await error(await GET(read()), 503, 'SETUP_REQUIRED');
    }
  });
  it('rejects expired identity without RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: {} }); await error(await GET(read()), 401, 'UNAUTHENTICATED'); expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects privileged key and never falls back', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_forbidden'); await error(await POST(write()), 503, 'SETUP_REQUIRED'); expect(createClient).not.toHaveBeenCalled();
  });
  it('preserves explicit replay and uncertain result semantics', async () => {
    setup('sales', { crm_v2_visit_follow_up_command: { data: { nextActionId: ACTION, activityId: null, replayed: true } } }); expect((await POST(write())).status).toBe(200);
    setup('sales', { crm_v2_visit_follow_up_command: { error: { code: 'XX000', message: 'private backend data' } } }); await error(await POST(write()), 503, 'SERVICE_UNAVAILABLE');
  });
});
