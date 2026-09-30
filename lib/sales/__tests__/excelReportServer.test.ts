// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUser: vi.fn(), create: vi.fn(), range: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.create }));
import * as route from '@/app/api/sales-crm/excel-report/route';
import { projectMapSnapshot } from './projectMapFixtures';
const snapshot = projectMapSnapshot();
const req = (auth = true) => new Request('https://test.invalid/api/sales-crm/excel-report?projectName=โครงการ A', { headers: auth ? { Authorization: 'Bearer fake-token' } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES']) vi.stubEnv(`SALES_CRM_${name}_ENABLED`, 'true');
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon');
  mock.create.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: snapshot.actor.userId } }, error: null });
  mock.rpc.mockImplementation(async name => ({ error: null, data: name === 'crm_v2_role' ? 'sales'
    : name === 'crm_v2_project_sales_capabilities' ? { enabled: true, contract_version: 'project_sales_v1' }
    : name === 'crm_v2_excel_evidence' ? { contractVersion: 'excel_evidence_v1', projectName: snapshot.projectName, actor: snapshot.actor,
      legacyVisits: [], completedVisits: [], forecasts: [], pendingLegacyRows: 0, pendingLegacyKeys: [], unknownLegacyDates: 0,
      unassignedLegacyVisits: [], unknownUnassignedLegacyDates: 0 }
    : snapshot.salePages[0] }));
  mock.range.mockResolvedValueOnce({ data: snapshot.plots.map(p => ({ id: p.id, plot_name: p.name, project_name: snapshot.projectName,
    has_customer: p.hasCustomer, is_completed: p.isCompleted, sale_status: p.saleStatus })), count: 2, error: null })
    .mockResolvedValue({ data: snapshot.plots.map(p => ({ id: p.id, project_name: snapshot.projectName,
      selling_price: null, land_appraisal_price: 0, house_types: { is_infrastructure: false } })), count: 2, error: null });
  mock.from.mockImplementation(() => {
    const builder = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: mock.range,
      maybeSingle: vi.fn().mockResolvedValue({ data: { name: snapshot.projectName, layout_data: [{ type: 'config', cols: 6, rows: 4 }, ...snapshot.layout.cells] }, error: null }) };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.order.mockReturnValue(builder); return builder;
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('bounded read-only Excel endpoint', () => {
  it('uses existing caller permissions and projects only reviewed plot prices and central sales', async () => {
    const response = await route.GET(req()); expect(response.status).toBe(200);
    const { data } = await response.json(); expect(data.map).toEqual(snapshot);
    expect(data.catalog[0]).toEqual({ plotId: 'P-1', basePrice: null, appraisalPrice: null, isInfrastructure: false });
    expect(mock.from.mock.calls.map(call => call[0])).toEqual(['projects', 'plots', 'plots']);
    expect(mock.create.mock.calls[0][2].global.headers.Authorization).toBe('Bearer fake-token');
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('requires login and a trusted sales role', async () => {
    expect((await route.GET(req(false))).status).toBe(401);
    mock.rpc.mockResolvedValue({ data: 'foreman', error: null }); expect((await route.GET(req())).status).toBe(403);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('fails closed when catalog is truncated or mismatched', async () => {
    mock.range.mockResolvedValue({ data: [], count: 2, error: null });
    const response = await route.GET(req()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('customerName');
  });
  it('keeps unknown house type unknown', async () => {
    mock.range.mockResolvedValue({ data: snapshot.plots.map(p => ({ id: p.id, project_name: snapshot.projectName,
      selling_price: null, land_appraisal_price: null, house_types: null })), count: 2, error: null });
    expect((await (await route.GET(req())).json()).data.catalog[0].isInfrastructure).toBeNull();
  });
});
