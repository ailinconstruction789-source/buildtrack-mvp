// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), projects: vi.fn(), plots: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/project-map/route';
import { projectMapSnapshot } from './projectMapFixtures';
import { pid, projectSale, projectScope, projectSnapshot } from './projectSalesFixtures';
const request = (query = '?projectName=โครงการ A', authenticated = true) => new Request(`https://test.invalid/api/sales-crm/project-map${query}`, { headers: authenticated ? { authorization: 'Bearer fake-token' } : {} });
const flags = ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES'];
beforeEach(() => {
  vi.resetAllMocks(); flags.forEach(flag => vi.stubEnv(`SALES_CRM_${flag}_ENABLED`, 'true'));
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_booking');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: pid(8), user_metadata: { role: 'admin' } } }, error: null });
  mock.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === 'crm_v2_role' ? 'sales'
    : name === 'crm_v2_project_sales_capabilities' ? { enabled: true, contract_version: 'project_sales_v1' }
    : projectSnapshot(projectScope({ tab: 'all', page: args.p_page })) }));
  const snapshot = projectMapSnapshot();
  mock.projects.mockResolvedValue({ data: { name: 'โครงการ A', layout_data: [{ type: 'config', cols: 6, rows: 4 }, ...snapshot.layout.cells] }, error: null });
  mock.plots.mockResolvedValue({ data: snapshot.plots.map(p => ({ id: p.id, plot_name: p.name, project_name: 'โครงการ A', has_customer: p.hasCustomer, is_completed: p.isCompleted, sale_status: p.saleStatus })), count: 2, error: null });
  mock.from.mockImplementation(table => {
    const builder = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: mock.projects, range: mock.plots };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.order.mockReturnValue(builder);
    if (!['plots', 'projects'].includes(table)) throw new Error('Unexpected direct table read');
    return builder;
  });
});
afterEach(() => vi.unstubAllEnvs());
async function error(response: Response, status: number) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  expect(await response.text()).not.toMatch(/fake-token|private detail|layout_data|customerName/);
}
describe('read-only project map authorization and complete data', () => {
  it('exposes GET only and projects explicit geometry/fields with caller JWT', async () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    const response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(projectMapSnapshot());
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer fake-token');
    expect(mock.from.mock.calls.map(c => c[0])).toEqual(['projects', 'plots']);
  });
  it.each(flags)('keeps %s feature gate before database access', async flag => {
    vi.stubEnv(`SALES_CRM_${flag}_ENABLED`, 'false'); await error(await route.GET(request()), 503);
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('requires valid auth and trusted sales role, not editable metadata', async () => {
    await error(await route.GET(request('', false)), 400);
    await error(await route.GET(request('?projectName=โครงการ A', false)), 401);
    mock.rpc.mockResolvedValue({ data: 'contractor', error: null });
    await error(await route.GET(request()), 403); expect(mock.from).not.toHaveBeenCalled();
  });
  it.each(['?projectName=A&projectName=B', '?projectName=A&tab=booked', '?projectName=A&page=1', '?projectName='])('rejects filters that could paint partial data %s', async query => {
    await error(await route.GET(request(query)), 400); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('reads every page, ignores table search filters, and refuses duplicate pagination', async () => {
    const first = { ...projectSnapshot(projectScope({ tab: 'all' })), hasMore: true,
      rows: Array.from({ length: 50 }, (_, n) => projectSale({ saleId: pid(n + 100), plotId: null, stage: 'cancelled' })) };
    const normal = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => name === 'crm_v2_project_sales' && args.p_page === 0 ? { data: first, error: null } : normal(name, args));
    let response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.salePages).toHaveLength(2);
    expect(mock.rpc).toHaveBeenCalledWith('crm_v2_project_sales', { p_project_name: 'โครงการ A', p_tab: 'all', p_query: '', p_page: 1 });
    first.rows[0].saleId = pid(1);
    response = await route.GET(request()); await error(response, 503);
  });
  it('fails closed if a later page fails, before reading layout', async () => {
    const normal = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => {
      if (name !== 'crm_v2_project_sales') return normal(name, args);
      if (args.p_page) return { error: { message: 'private detail', code: 'unknown' } };
      return { data: { ...projectSnapshot(projectScope({ tab: 'all' })), hasMore: true,
        rows: Array.from({ length: 50 }, (_, n) => projectSale({ saleId: pid(n + 100), plotId: null, stage: 'cancelled' })) } };
    });
    await error(await route.GET(request()), 503); expect(mock.from).not.toHaveBeenCalled();
  });
  it('rejects truncated plot results, missing project, and layout read failures', async () => {
    mock.plots.mockResolvedValueOnce({ data: [], count: 2, error: null }); await error(await route.GET(request()), 503);
    mock.projects.mockResolvedValueOnce({ data: null, error: null }); await error(await route.GET(request()), 503);
    mock.projects.mockResolvedValueOnce({ error: { code: '42501', message: 'private detail' } }); await error(await route.GET(request()), 403);
  });
  it('rejects cross-project data even with successful HTTP from upstream', async () => {
    mock.projects.mockResolvedValueOnce({ data: { name: 'B', layout_data: [] }, error: null });
    await error(await route.GET(request()), 503);
  });
  it('rejects service credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_test');
    await error(await route.GET(request()), 503); expect(mock.createClient).not.toHaveBeenCalled();
  });
});
