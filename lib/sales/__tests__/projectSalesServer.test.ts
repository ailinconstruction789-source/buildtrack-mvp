// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/project-sales/route';
import { pid, projectSnapshot } from './projectSalesFixtures';
import { projectSalesEnabled, projectWorkspaceMode } from '../projectSalesFlags';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED', 'SALES_CRM_PROJECT_SALES_ENABLED'];
const request = (query = '?projectName=โครงการ A', authenticated = true) => new Request(`https://test.invalid/${query}`, { headers: authenticated ? { authorization: 'Bearer fake-token' } : {} });
function configure(role = 'sales', overrides: Record<string, unknown> = {}) {
  const snapshot = projectSnapshot(); snapshot.actor.role = role as never;
  mock.rpc.mockImplementation(async name => overrides[name] ?? { data: name === 'crm_v2_role' ? role
    : name === 'crm_v2_project_sales_capabilities' ? { enabled: true, contract_version: 'project_sales_v1' } : snapshot, error: null });
}
beforeEach(() => {
  vi.clearAllMocks(); flags.forEach(flag => vi.stubEnv(flag, 'true')); vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: pid(8), user_metadata: { role: 'admin' } } }, error: null }); configure();
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
async function assertError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  const body = await response.json(); expect(body.error.code).toBe(code); expect(JSON.stringify(body)).not.toMatch(/fake-token|private customer/);
}
describe('project sales read boundary', () => {
  it('preserves imported history in the project API without accepting preview or broken provenance', async () => {
    const snapshot = projectSnapshot();
    Object.assign(snapshot.rows[0], { bookingRound: null, importedHistory: {
      source: 'customer_sheet', batchId: pid(90), sourceRow: 966, sourceStage: 'booked',
      bookedDate: '2026-09-26', cancelledDate: null, transferredDate: null } });
    configure('sales', { crm_v2_project_sales: { data: snapshot, error: null } });
    const response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.rows[0]).toEqual(snapshot.rows[0]);
    delete snapshot.rows[0].importedHistory;
    await assertError(await route.GET(request()), 503, 'SETUP_REQUIRED');
  });
  it.each(flags)('checks %s before constructing a client', async flag => {
    vi.stubEnv(flag, 'false'); await assertError(await route.GET(request()), 503, 'FEATURE_DISABLED');
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('never exposes a write handler and always disables response caching', async () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    const result = await route.GET(request()); expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
    expect((await result.json()).data).toEqual(projectSnapshot());
    expect(mock.rpc).toHaveBeenCalledWith('crm_v2_project_sales', { p_project_name: 'โครงการ A', p_tab: 'booked', p_query: '', p_page: 0 });
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_project_sales_capabilities', 'crm_v2_project_sales']);
  });
  it.each(['sales', 'admin', 'owner'])('allows trusted %s globally to read', async role => {
    configure(role); expect((await route.GET(request())).status).toBe(200);
    expect(mock.getUser).toHaveBeenCalledWith('fake-token');
  });
  it('rejects anonymous callers and does not trust metadata role', async () => {
    await assertError(await route.GET(request('', false)), 401, 'UNAUTHENTICATED');
    configure('contractor'); await assertError(await route.GET(request()), 403, 'FORBIDDEN');
  });
  it.each(['sb_secret_forbidden', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])('rejects privileged public-key misconfiguration %s', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await assertError(await route.GET(request()), 503, 'SETUP_REQUIRED');
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('rejects invalid filters before any RPC', async () => {
    await assertError(await route.GET(request('?projectName=A&role=admin')), 400, 'INVALID_INPUT'); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false, contract_version: 'project_sales_v1' }, { enabled: true, contract_version: 'wrong' }, null])('fails closed when database reader not ready %j', data => {
    configure('sales', { crm_v2_project_sales_capabilities: { data, error: null } });
    return route.GET(request()).then(response => assertError(response, 503, 'SETUP_REQUIRED'));
  });
  it('rejects mismatched caller identity and unexpected project', async () => {
    const snapshot = projectSnapshot(); snapshot.actor.userId = pid(50);
    configure('sales', { crm_v2_project_sales: { data: snapshot } }); await assertError(await route.GET(request()), 503, 'SETUP_REQUIRED');
    snapshot.actor.userId = pid(8); snapshot.rows[0].projectName = 'โครงการ B';
    await assertError(await route.GET(request()), 503, 'SETUP_REQUIRED');
  });
  it.each([['PGRST202', '', 503, 'SETUP_REQUIRED'], ['P0001', 'CRM_PROJECT_SALES_SETUP_REQUIRED', 503, 'SETUP_REQUIRED'],
    ['P0001', 'CRM_PROJECT_SALES_NOT_FOUND', 404, 'NOT_FOUND'], ['42501', '', 403, 'FORBIDDEN'], ['unknown', 'private customer', 503, 'READ_UNAVAILABLE']] as const)('sanitizes database failure %s %s', async (code, message, status, result) => {
    configure('sales', { crm_v2_project_sales: { error: { code, message, details: 'private customer' } } });
    await assertError(await route.GET(request()), status, result);
  });
  it('separates preview from retiring legacy and never falls back on partial activation', () => {
    expect(projectSalesEnabled()).toBe(true); expect(projectWorkspaceMode()).toBe('legacy');
    vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'true'); expect(projectWorkspaceMode()).toBe('central');
    for (const flag of flags) { vi.stubEnv(flag, 'false'); expect(projectWorkspaceMode()).toBe('blocked'); vi.stubEnv(flag, 'true'); }
  });
});
