// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as staff from '@/app/api/sales-crm/customer-voices/route';
import * as customer from '@/app/api/customer-voices/route';
import { voiceId, voiceInput, voiceResult, voiceScope, voiceSnapshot, voiceSubmission, voiceToken } from './customerVoicesFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_VISITS_ENABLED', 'SALES_CRM_CUSTOMER_VOICES_ENABLED'];
const request = (input: unknown, headers: Record<string, string> = {}) => new Request('https://local.invalid/api/customer-voices', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
const get = (headers: Record<string, string> = { Authorization: 'Bearer test-staff' }) => new Request(`https://local.invalid/api/sales-crm/customer-voices?${new URLSearchParams(voiceScope() as unknown as Record<string, string>)}`, { headers });
const post = () => request(voiceInput(), { Authorization: 'Bearer test-staff' });
function configure(role = 'sales', overrides: Record<string, unknown> = {}) {
  const snapshot = voiceSnapshot(); snapshot.actor.role = role as typeof snapshot.actor.role; if (role === 'owner') snapshot.scope.canManage = false;
  mock.rpc.mockImplementation(async (name: string) => overrides[name] ?? ({ crm_v2_role: { data: role }, crm_v2_customer_voices_capabilities: { data: { enabled: true, contract_version: 'customer_voices_v1' } },
    crm_v2_customer_voices_context: { data: snapshot }, crm_v2_customer_voices_command: { data: voiceResult() },
    crm_v2_customer_voice_open: { data: { formVersion: 'customer_voices_v1', expiresAt: '2026-09-25T10:00:00Z' } }, crm_v2_customer_voice_submit: { data: { submitted: true, replayed: false } } }[name]));
}
beforeEach(() => {
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits');
  vi.resetAllMocks(); flags.forEach(key => vi.stubEnv(key, 'true')); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc }); mock.getUser.mockResolvedValue({ data: { user: { id: voiceId(5), user_metadata: { role: 'admin' } } } }); configure();
});
afterEach(() => vi.unstubAllEnvs());
async function error(response: Response, status: number, code: string) { expect(response.status).toBe(status); expect((await response.json()).error.code).toBe(code); }
describe('staff + public Customer Voices routes', () => {
  it.each(flags)('checks exact flag %s before database access on all routes', async key => {
    vi.stubEnv(key, 'TRUE'); await error(await staff.GET(get()), 503, 'FEATURE_DISABLED'); await error(await staff.POST(post()), 503, 'FEATURE_DISABLED');
    await error(await customer.POST(request(voiceSubmission())), 503, 'FEATURE_DISABLED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('reads the requested Visit with caller JWT, no-cache and privacy headers', async () => {
    const result = await staff.GET(get()); expect(result.status).toBe(200); expect((await result.json()).data).toEqual(voiceSnapshot());
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_customer_voices_context', { p_customer_id: voiceId(1), p_interest_id: voiceId(2), p_visit_id: voiceId(3) });
    expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer test-staff');
  });
  it.each(['sales', 'admin', 'owner'])('allows %s to read, while only Sales/Admin manage', async role => {
    configure(role); expect((await staff.GET(get())).status).toBe(200); expect((await staff.POST(post())).status).toBe(role === 'owner' ? 403 : 201);
  });
  it('sends only the SHA256 token hash to database and never returns secret/hash', async () => {
    const result = await staff.POST(post()); expect(result.status).toBe(201); const response = await result.text(); expect(response).not.toContain(voiceToken);
    const { requestId, token, ...rest } = voiceInput(); const hash = createHash('sha256').update(token!).digest('hex');
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_customer_voices_command', { p_request_id: requestId, p_payload: { ...rest, tokenHash: hash } }); expect(response).not.toContain(hash);
    configure('sales', { crm_v2_customer_voices_command: { data: { ...voiceResult(), replayed: true } } }); expect((await staff.POST(post())).status).toBe(200);
  });
  it('uses anonymous capability on public open even with forged staff headers/cookies', async () => {
    const response = await customer.POST(request({ command: 'open', token: voiceToken }, { Authorization: 'Bearer fake-admin', Cookie: 'session=secret' }));
    expect(response.status).toBe(200); expect(mock.getUser).not.toHaveBeenCalled(); expect(mock.createClient.mock.calls[0][2]).not.toHaveProperty('global');
    expect(mock.rpc).toHaveBeenCalledOnce(); expect(mock.rpc).toHaveBeenCalledWith('crm_v2_customer_voice_open', { p_token: voiceToken });
    expect(Object.keys((await response.json()).data).sort()).toEqual(['expiresAt', 'formVersion']);
  });
  it('passes original public capability for DB-side hashing and only returns a generic acknowledgement', async () => {
    const input = voiceSubmission(), result = await customer.POST(request(input)); expect(result.status).toBe(201); expect((await result.json()).data).toEqual({ submitted: true, replayed: false });
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_customer_voice_submit', { p_token: voiceToken, p_request_id: input.requestId, p_form_version: input.formVersion, p_answers: input.answers });
    configure('sales', { crm_v2_customer_voice_submit: { data: { submitted: true, replayed: true } } }); expect((await customer.POST(request(input))).status).toBe(200);
  });
  it.each(['sb_secret_bad', `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`])('rejects privileged configuration on staff and public routes', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await error(await staff.POST(post()), 503, 'SETUP_REQUIRED'); await error(await customer.POST(request(voiceSubmission())), 503, 'SETUP_REQUIRED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('requires verified staff role/capability rather than user metadata', async () => {
    await error(await staff.GET(get({})), 401, 'UNAUTHENTICATED'); configure('contractor'); await error(await staff.POST(post()), 403, 'FORBIDDEN');
    configure('sales', { crm_v2_customer_voices_capabilities: { data: { enabled: true, contract_version: 'wrong' } } }); await error(await staff.POST(post()), 503, 'SETUP_REQUIRED');
    mock.getUser.mockResolvedValue({ data: { user: null } }); await error(await staff.POST(post()), 401, 'UNAUTHENTICATED');
  });
  it('bounds declared/actual UTF8 input before auth and requires JSON', async () => {
    await error(await customer.POST(request(voiceSubmission(), { 'Content-Length': '16385' })), 413, 'PAYLOAD_TOO_LARGE');
    await error(await customer.POST(request({ ...voiceSubmission(), other: 'ก'.repeat(6000) })), 413, 'PAYLOAD_TOO_LARGE');
    await error(await staff.POST(request(voiceInput(), { 'Content-Type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await error(await customer.POST(new Request('https://local.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xc3, 0x28]) })), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('refuses query tokens/extra input/missing scores before DB access', async () => {
    await error(await customer.POST(new Request('https://local.invalid/?token=secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(voiceSubmission()) })), 400, 'INVALID_INPUT');
    await error(await customer.POST(request({ ...voiceSubmission(), answers: {} })), 400, 'INVALID_INPUT');
    await error(await staff.POST(request({ ...voiceInput(), actorId: voiceId(99) })), 400, 'INVALID_INPUT'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('never serializes extra public data, corrupt acknowledgements or another staff scope', async () => {
    configure('sales', { crm_v2_customer_voice_open: { data: { formVersion: 'customer_voices_v1', expiresAt: '2026-09-25T10:00:00Z', phone: 'private' } },
      crm_v2_customer_voice_submit: { data: { submitted: true, replayed: false, answers: voiceSubmission().answers } },
      crm_v2_customer_voices_context: { data: { ...voiceSnapshot(), actor: { userId: voiceId(99), role: 'sales' } } } });
    await error(await customer.POST(request({ command: 'open', token: voiceToken })), 503, 'READ_UNAVAILABLE');
    await error(await customer.POST(request(voiceSubmission())), 503, 'UNKNOWN_RESULT'); await error(await staff.GET(get()), 503, 'SETUP_REQUIRED');
  });
  it.each(['NOT_FOUND', 'FORBIDDEN', 'STALE_STATE', 'SCOPE_CLOSED', 'TOKEN_UNAVAILABLE'])('public errors collapse %s without revealing existence', async code => {
    configure('sales', { crm_v2_customer_voice_open: { error: { code: 'P0001', message: `CRM_VOICE_${code}` } } });
    await error(await customer.POST(request({ command: 'open', token: voiceToken })), 410, 'TOKEN_UNAVAILABLE');
  });
  it('sanitizes errors, preserves unknown result and never retries automatically', async () => {
    mock.rpc.mockRejectedValue(new Error(`private ${voiceToken}`)); const response = await customer.POST(request(voiceSubmission()));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(voiceToken); expect(mock.rpc).toHaveBeenCalledOnce();
  });
});
