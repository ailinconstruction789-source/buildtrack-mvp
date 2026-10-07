// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/reports/route';
import { reportActor, reportScope, reportSnapshot } from './salesReportsFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED', 'SALES_CRM_PROJECT_SALES_ENABLED'];
const request = (query = '', token = 'fake-token') => new Request(`https://test.invalid/${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
function configure(role = 'sales', overrides: Record<string, unknown> = {}) {
  const snapshot = reportSnapshot(); snapshot.actor.role = role as never;
  mock.rpc.mockImplementation(async name => overrides[name] ?? { data: name === 'crm_v2_role' ? role
    : name === 'crm_v2_sales_reports_capabilities' ? { enabled: true, contract_version: 'sales_reports_v1' } : snapshot, error: null });
}
beforeEach(() => {
  vi.clearAllMocks(); flags.forEach(flag => vi.stubEnv(flag, 'true'));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: reportActor, user_metadata: { role: 'admin' } } }, error: null }); configure();
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  const body = await response.json(); expect(body.error.code).toBe(code); expect(JSON.stringify(body)).not.toMatch(/fake-token|private customer/);
}
describe('report API read boundary', () => {
  it.each(flags)('fails closed before client construction if %s is off', async flag => {
    vi.stubEnv(flag, 'false'); await error(await route.GET(request()), 503, 'FEATURE_DISABLED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('exposes GET only and uses one whole-scope aggregate, not pages or browser joins', async () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    const response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(reportSnapshot());
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_sales_reports_capabilities', 'crm_v2_sales_report']);
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_sales_report', { p_project_name: null, p_from_date: null, p_to_date: null });
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer fake-token');
  });
  it('forwards a selected project and original lead cohort, stripping unrelated output', async () => {
    const scope = reportScope({ projectName: 'โครงการ A', fromDate: '2024-02-29', toDate: '2024-03-01' });
    configure('sales', { crm_v2_sales_report: { data: { ...reportSnapshot(scope), private: 'private customer' } } });
    const response = await route.GET(request(`?${new URLSearchParams({ projectName: scope.projectName!, fromDate: scope.fromDate!, toDate: scope.toDate! })}`));
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual(reportSnapshot(scope));
  });
  it.each(['sales', 'admin', 'owner'])('allows trusted %s role', async role => { configure(role); expect((await route.GET(request())).status).toBe(200); });
  it('rejects anonymous and forged metadata role', async () => {
    await error(await route.GET(request('', '')), 401, 'UNAUTHENTICATED');
    configure('contractor'); await error(await route.GET(request()), 403, 'FORBIDDEN');
  });
  it.each(['sb_secret_forbidden', `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`])('does not use privileged keys %s', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key); await error(await route.GET(request()), 503, 'SETUP_REQUIRED'); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false, contract_version: 'sales_reports_v1' }, { enabled: true, contract_version: 'wrong' }, null])('requires exact database capability %j', async data => {
    configure('sales', { crm_v2_sales_reports_capabilities: { data } }); await error(await route.GET(request()), 503, 'SETUP_REQUIRED');
  });
  it('rejects bad query before RPC and rejects mismatched actor/inconsistent totals', async () => {
    await error(await route.GET(request('?fromDate=2026-01-01')), 400, 'INVALID_INPUT'); expect(mock.rpc).not.toHaveBeenCalled();
    const raw = reportSnapshot(); raw.actor.userId = '20000000-0000-4000-8000-000000000099';
    configure('sales', { crm_v2_sales_report: { data: raw } }); await error(await route.GET(request()), 503, 'SETUP_REQUIRED');
    raw.actor.userId = reportActor; raw.totals.netBookedHomes = 100;
    await error(await route.GET(request()), 503, 'SETUP_REQUIRED');
  });
  it.each([['PGRST202', '', 503, 'SETUP_REQUIRED'], ['P0001', 'CRM_SALES_REPORTS_SETUP_REQUIRED', 503, 'SETUP_REQUIRED'],
    ['P0001', 'CRM_SALES_REPORTS_NOT_FOUND', 404, 'NOT_FOUND'], ['42501', '', 403, 'FORBIDDEN'], ['unknown', 'private customer', 503, 'READ_UNAVAILABLE']] as const)('sanitizes %s %s', async (code, message, status, result) => {
    configure('sales', { crm_v2_sales_report: { error: { code, message } } }); await error(await route.GET(request()), status, result);
  });
});
